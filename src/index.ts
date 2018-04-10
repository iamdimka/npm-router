import * as pathToRegexp from "path-to-regexp"
import Context from "./context"
import { Server, IncomingMessage, ServerResponse, createServer } from "http"
import Cookies, { CookieOptions } from "./cookies"
import { createContext } from "vm";

export { Context, Cookies, CookieOptions }

export interface Options extends pathToRegexp.RegExpOptions {
  exact?: boolean
}

export interface Middleware<Ctx = { [key: string]: any }> {
  ($: Context<Ctx>, next: () => void): any
}

export interface CloseListener {
  host: string
  port: number
  server: Server
  (): Promise<void>
}

export default class Router<RouterContext extends {} = { [key: string]: any }, MiddlewareContext extends RouterContext = RouterContext> {
  protected readonly _middlewares: Middleware<MiddlewareContext>[] = []
  readonly ctx: RouterContext

  constructor(ctx: RouterContext = {} as RouterContext, createContext?: Middleware<Partial<MiddlewareContext> & RouterContext>) {
    this.ctx = ctx

    if (createContext) {
      this.use(createContext)
    }
  }

  use(...middlewares: Middleware<MiddlewareContext>[]): this {
    this._middlewares.push(...middlewares)
    return this
  }

  route(method: string, middleware: Middleware<MiddlewareContext>): this
  route(method: string, path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  route(method: string, path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    if (typeof path === "function") {
      return this.use(($, next) => {
        if (method !== "ANY" && $.method !== method) {
          return next()
        }

        return path($, next)
      })
    }

    const keys: pathToRegexp.Key[] = []
    const re = pathToRegexp(path, keys, options)
    const exact = !options || !options.exact

    return this.use(($, next) => {
      if (method !== "ANY" && $.method !== method) {
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

  any(middleware: Middleware<MiddlewareContext>): this
  any(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  any(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("ANY", path as any, middleware as any, options)
  }

  options(middleware: Middleware<MiddlewareContext>): this
  options(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  options(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("OPTIONS", path as any, middleware as any, options)
  }

  get(middleware: Middleware<MiddlewareContext>): this
  get(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  get(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("GET", path as any, middleware as any, options)
  }

  head(middleware: Middleware<MiddlewareContext>): this
  head(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  head(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("HEAD", path as any, middleware as any, options)
  }

  post(middleware: Middleware<MiddlewareContext>): this
  post(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  post(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("POST", path as any, middleware as any, options)
  }

  put(middleware: Middleware<MiddlewareContext>): this
  put(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  put(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("PUT", path as any, middleware as any, options)
  }

  patch(middleware: Middleware<MiddlewareContext>): this
  patch(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  patch(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("PATCH", path as any, middleware as any, options)
  }

  delete(middleware: Middleware<MiddlewareContext>): this
  delete(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  delete(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("DELETE", path as any, middleware as any, options)
  }

  trace(middleware: Middleware<MiddlewareContext>): this
  trace(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  trace(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("TRACE", path as any, middleware as any, options)
  }

  connect(middleware: Middleware<MiddlewareContext>): this
  connect(path: pathToRegexp.Path, middleware: Middleware<MiddlewareContext>, options?: Options): this
  connect(path: pathToRegexp.Path | Middleware<MiddlewareContext>, middleware?: Middleware<MiddlewareContext>, options?: Options): this {
    return this.route("CONNECT", path as any, middleware as any, options)
  }

  listener() {
    const { _middlewares: middlewares, ctx } = this

    function router($: Context<MiddlewareContext>, next: () => void) {
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

    function finalize($: Context<MiddlewareContext>) {
      if ($.bypass) {
        return
      }

      $.status = 404
      $.end()
    }

    return (req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 200
      const $ = new Context<MiddlewareContext>(req, res, Object.create(ctx))

      router($, () => finalize($)).catch(e => {
        console.error(e)

        if (!res.headersSent) {
          res.statusCode = 500
        }
      }).then(() => {
        finalize($)
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
            port: address.port,
            server: server
          })

        resolve(closeListener)
      })
    })
  }
}