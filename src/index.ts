import * as pathToRegexp from "path-to-regexp"
import Context from "./context"
import { IncomingMessage, ServerResponse, createServer } from "http"

export interface Options extends pathToRegexp.RegExpOptions {
  exact?: boolean
}

export interface Middleware<UserContext> {
  ($: Context<UserContext>, next: () => void): any
}

export interface CloseListener {
  host: string
  port: number
  (): Promise<void>
}

export default class Router<UserContext extends {} = {}> {
  protected readonly _middlewares: Middleware<UserContext>[] = []
  readonly ctx: UserContext

  constructor(ctx: UserContext = {} as UserContext) {
    this.ctx = ctx
  }

  use(...middlewares: Middleware<UserContext>[]): this {
    this._middlewares.push(...middlewares)
    return this
  }

  route(method: string, middleware: Middleware<UserContext>): this
  route(method: string, path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  route(method: string, path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    if (typeof path === "function") {
      return this.use(($, next) => {
        if ($.method !== method) {
          return next()
        }

        return path($, next)
      })
    }

    const keys: pathToRegexp.Key[] = []
    const re = pathToRegexp(path, keys, options)
    const exact = options && options.exact

    return this.use(($, next) => {
      if ($.method !== method) {
        return next()
      }

      const match = re.exec($.pathname)
      if (!match) {
        return next()
      }

      if (exact && $.pathname !== match[0]) {
        return next()
      }

      keys.forEach((key, i) => {
        $.params[key.name] = match[i + 1]
      })

      return middleware!($, next)
    })
  }

  options(middleware: Middleware<UserContext>): this
  options(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  options(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("OPTIONS", path as any, middleware as any, options)
  }

  get(middleware: Middleware<UserContext>): this
  get(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  get(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("GET", path as any, middleware as any, options)
  }

  head(middleware: Middleware<UserContext>): this
  head(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  head(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("HEAD", path as any, middleware as any, options)
  }

  post(middleware: Middleware<UserContext>): this
  post(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  post(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("POST", path as any, middleware as any, options)
  }

  put(middleware: Middleware<UserContext>): this
  put(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  put(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("PUT", path as any, middleware as any, options)
  }

  patch(middleware: Middleware<UserContext>): this
  patch(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  patch(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("PATCH", path as any, middleware as any, options)
  }

  delete(middleware: Middleware<UserContext>): this
  delete(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  delete(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("DELETE", path as any, middleware as any, options)
  }

  trace(middleware: Middleware<UserContext>): this
  trace(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  trace(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("TRACE", path as any, middleware as any, options)
  }

  connect(middleware: Middleware<UserContext>): this
  connect(path: pathToRegexp.Path, middleware: Middleware<UserContext>, options?: Options): this
  connect(path: pathToRegexp.Path | Middleware<UserContext>, middleware?: Middleware<UserContext>, options?: Options): this {
    return this.route("CONNECT", path as any, middleware as any, options)
  }

  listener() {
    const { _middlewares: middlewares, ctx } = this

    function router($: Context<UserContext>, next: () => void) {
      let i = -1
      const { length } = middlewares

      return run(0)

      function run(n: number): Promise<any> {
        if (i >= n) {
          return Promise.reject(new Error("Stop to call next()"))
        }

        i = n
        if (n >= length) {
          return Promise.resolve(next())
        }

        const fn = middlewares[n]

        try {
          return Promise.resolve(fn($, () => run(n + 1)))
        } catch (e) {
          return Promise.reject(e)
        }
      }
    }

    function finalize(res: ServerResponse) {
      if (!res.headersSent) {
        res.flushHeaders()
      }

      if (!res.finished) {
        res.end()
      }
    }

    return (req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 404
      const $ = new Context(req, res, ctx)

      router($, () => finalize(res)).catch(e => {
        console.error(e)

        if (!res.headersSent) {
          res.statusCode = 500
        }

        finalize(res)
      })
    }
  }

  listen(address: string): Promise<CloseListener>
  listen(host: string, port: number): Promise<CloseListener>
  listen(host: string, port?: number): Promise<CloseListener> {
    if (arguments.length === 1) {
      const address = host.split(":")
      host = address[0]
      port = parseInt(address[1]) || 0
    }

    return new Promise((resolve, reject) => {
      const server = createServer(this.listener())
      server.on("error", reject)
      server.listen(port, host, () => {
        server.removeListener("error", reject)
        const address = server.address()

        const closeListener = Object.assign(() => new Promise<void>((resolve, reject) =>
          server.close((err: Error) => err ? reject(err) : resolve())
        ), {
            host: address.address,
            port: address.port
          })

        resolve(closeListener)
      })
    })
  }
}