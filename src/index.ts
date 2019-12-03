import Context from "./context"
import { Server, IncomingMessage, ServerResponse, createServer } from "http"
import { createSecureServer, SecureServerOptions, Http2SecureServer } from "http2"
import Cookies, { CookieOptions } from "./cookies"
import compile from "./match-path"

export { Context, Cookies, CookieOptions }

export interface Middleware<Ctx extends Context = Context> {
  ($: Ctx, next: () => void): any
}

export interface CloseListener {
  host: string
  port: number
  server: Server | Http2SecureServer
  close(): Promise<void>
}

export interface Constructor<Ctx extends Context = Context> {
  new(req: IncomingMessage, res: ServerResponse, ...args: any[]): Ctx
}

interface Method<Ctx extends Context> {
  (method: string | undefined, middleware: Middleware<Ctx>): this
  (method: string | undefined, path: string | string[], middleware: Middleware<Ctx>): this
}

export default interface Router<Ctx extends Context = Context> {
  readonly get: Method<Ctx>
  readonly post: Method<Ctx>
  readonly put: Method<Ctx>
  readonly patch: Method<Ctx>
  readonly head: Method<Ctx>
  readonly options: Method<Ctx>
  readonly delete: Method<Ctx>
  readonly trace: Method<Ctx>
  readonly connect: Method<Ctx>
}

export default class Router<Ctx extends Context = Context> {
  protected readonly _middlewares: Middleware<Ctx>[] = []
  readonly ContextConstructor: Constructor<Ctx>
  protected _tlsOptions?: SecureServerOptions
  protected _server?: Server | Http2SecureServer

  protected _handleError: (e: any, $: Ctx) => any = defaultHandler

  constructor(ctx?: Constructor<Ctx>) {
    this.ContextConstructor = ctx || Context as any
  }

  clone(): Router<Ctx> {
    const router = new Router(this.ContextConstructor)
    router._tlsOptions = this._tlsOptions
    router._handleError = this._handleError
    router._middlewares.push(...this._middlewares.slice(0))
    return router
  }

  server(server: Server | Http2SecureServer): this {
    this._server = server
    return this
  }

  tls(options: SecureServerOptions): this {
    this._tlsOptions = options
    return this
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
  route(method: string | undefined, path: string | string[], middleware: Middleware<Ctx>): this
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

    const [method, path, middleware] = arguments
    if (Array.isArray(path)) {
      path.forEach(path => this.route(method, path, middleware))
      return this
    }

    const check = compile(path)

    return this.use(($, next) => {
      if (method && $.method !== method) {
        return next()
      }

      if (check($.pathname, $.params)) {
        return middleware($, next)
      }

      return next()
    })
  }

  any(middleware: Middleware<Ctx>): this
  any(path: string | string[], middleware: Middleware<Ctx>): this
  any(): this {
    return (this.route as any)(undefined, ...arguments)
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
  listen(port: number): Promise<CloseListener>
  listen(host: string, port: number): Promise<CloseListener>
  listen(host: string | number, port?: number): Promise<CloseListener> {
    if (arguments.length === 1) {
      if (typeof host === "number") {
        port = host
        host = "0.0.0.0"
      } else {
        const sep = host.indexOf(":")
        if (sep === -1) {
          port = 0
        } else {
          port = parseInt(host.substr(sep + 1)) || 0
          host = host.substr(0, sep)
        }
      }
    }

    return new Promise((resolve, reject) => {
      const server = this._server || (this._tlsOptions ? createSecureServer(this._tlsOptions) : createServer())
      const listener = this.listener()
      server.on("request", listener)
      server.on("error", reject)
      server.listen(port, host as string, () => {
        this._server = server
        server.removeListener("request", listener)
        server.removeListener("error", reject)
        const address = server.address() as { address: string, port: number }

        resolve({
          server,
          host: address.address,
          port: address.port,
          close() {
            return new Promise<void>((resolve, reject) => {
              server.removeListener("request", listener)
              server.close((err?: Error) => err ? reject(err) : resolve())
            })
          }
        })
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

void ["GET", "POST", "PUT", "PATCH", "HEAD", "OPTIONS", "DELETE", "TRACE", "CONNECT"].forEach(method => {
  //@ts-ignore
  Router.prototype[method.toLowerCase()] = function () {
    return (this.route as any)(method, ...arguments)
  }
})