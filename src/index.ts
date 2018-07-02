import * as pathToRegexp from "path-to-regexp"
import Context from "./context"
import { Server, IncomingMessage, ServerResponse, createServer } from "http"
import Cookies, { CookieOptions } from "./cookies"

export { Context, Cookies, CookieOptions }

export interface Options extends pathToRegexp.RegExpOptions {
  exact?: boolean
}

export interface Middleware<Ctx extends Context = Context> {
  ($: Ctx, next: () => void): any
}

export interface CloseListener {
  host: string
  port: number
  server: Server
  (): Promise<void>
}

export interface Constructor<Ctx extends Context = Context> {
  new(req: IncomingMessage, res: ServerResponse, ...args: any[]): Ctx
}

export default class Router<Ctx extends Context = Context> {
  protected readonly _middlewares: Middleware<Ctx>[] = []
  readonly ContextConstructor: Constructor<Ctx>

  protected _handleError: (e: any, $: Ctx) => any = defaultHandler

  constructor(ctx?: Constructor<Ctx>) {
    this.ContextConstructor = ctx || Context as any
  }

  handleError(handler: (e: any, $: Ctx) => any): this {
    this._handleError = handler
    return this
  }

  use(...middlewares: Middleware<Ctx>[]): this {
    this._middlewares.push(...middlewares)
    return this
  }

  route(method: string | undefined, middleware: Middleware<Ctx>): this
  route(method: string | undefined, path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  route(): this {
    if (typeof arguments[1] === "function") {
      const [method, middleware] = arguments

      return this.use(($, next) => {
        if (method && $.method !== method) {
          return next()
        }

        return middleware($, next)
      })
    }

    const [method, path, middleware, options] = arguments

    const keys: pathToRegexp.Key[] = []
    const re = pathToRegexp(path, keys, options)
    const keysLength = keys.length
    const exact = !options || !options.exact

    return this.use(($, next) => {
      if (method && $.method !== method) {
        return next()
      }

      const match = re.exec($.pathname)
      if (!match) {
        return next()
      }

      if (exact && $.pathname !== match[0]) {
        return next()
      }

      for (let i = 0; i < keysLength; i++) {
        $.params[keys[i].name] = match[i + 1]
      }

      return middleware!($, next)
    })
  }

  any(middleware: Middleware<Ctx>): this
  any(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  any(): this {
    return (this.route as any)(undefined, ...arguments)
  }

  options(middleware: Middleware<Ctx>): this
  options(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  options(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("OPTIONS", ...arguments)
  }

  get(middleware: Middleware<Ctx>): this
  get(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  get(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("GET", ...arguments)
  }

  head(middleware: Middleware<Ctx>): this
  head(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  head(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("HEAD", ...arguments)
  }

  post(middleware: Middleware<Ctx>): this
  post(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  post(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("POST", ...arguments)
  }

  put(middleware: Middleware<Ctx>): this
  put(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  put(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("PUT", ...arguments)
  }

  patch(middleware: Middleware<Ctx>): this
  patch(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  patch(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("PATCH", ...arguments)
  }


  delete(middleware: Middleware<Ctx>): this
  delete(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  delete(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("DELETE", ...arguments)
  }

  trace(middleware: Middleware<Ctx>): this
  trace(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  trace(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("TRACE", ...arguments)
  }

  connect(middleware: Middleware<Ctx>): this
  connect(path: pathToRegexp.Path, middleware: Middleware<Ctx>, options?: Options): this
  connect(path: pathToRegexp.Path | Middleware<Ctx>, middleware?: Middleware<Ctx>, options?: Options): this {
    return (this.route as any)("CONNECT", ...arguments)
  }

  listener() {
    const { _middlewares: middlewares, ContextConstructor, _handleError } = this

    function router($: Ctx, next: () => void) {
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

    function finalize($: Ctx) {
      if ($.bypass || $.res.finished) {
        return
      }

      $.status = 404
      $.end()
    }

    return (req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 200
      const $ = new ContextConstructor(req, res)

      router($, () => finalize($))
        .then(() => finalize($))
        .catch(e => _handleError(e, $))
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
        const address: any = server.address()

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

function defaultHandler<Ctx extends Context>(e: any, { res }: Ctx) {
  console.error(e)

  if (!res.headersSent) {
    res.statusCode = 500
  }

  if (!res.finished) {
    res.end()
  }
}