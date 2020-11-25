import { Server, createServer } from "http";
import { createSecureServer, SecureServerOptions, Http2SecureServer } from "http2";
import Cookies, { CookieOptions } from "./Cookies";
import compile from "./matchPath";
import { compose, composeErrorMiddleware } from "./util";
import Request from "./Request";
import Response from "./Response";

export { Request, Response, Cookies, CookieOptions };

export interface Middleware {
  (request: Request, response: Response, next: (error?: Error) => void): any;
}

export interface ErrorMiddleware {
  (error: Error, request: Request, response: Response, next: (error?: Error) => void): any;
}

export interface ClassMiddleware {
  middleware: Middleware;
}

export type AnyMiddleware = ClassMiddleware | Middleware;

export interface CloseListener {
  host: string;
  port: number;
  server: Server | Http2SecureServer;
  close(): Promise<void>;
}

export interface Method {
  (path: undefined | string | string[], middleware: Middleware, ...middlewares: Middleware[]): this;
  (middleware: Middleware, ...middlewares: Middleware[]): this;
}

export default interface Router {
  readonly get: Method;
  readonly post: Method;
  readonly put: Method;
  readonly patch: Method;
  readonly head: Method;
  readonly options: Method;
  readonly delete: Method;
  readonly trace: Method;
  readonly connect: Method;
}

export default class Router {
  protected readonly middlewares: Middleware[] = [];
  protected readonly errorMiddlewares: ErrorMiddleware[] = [];

  protected tlsOptions?: SecureServerOptions;
  protected server?: Server | Http2SecureServer;
  protected prefix: string = "";
  protected Request: typeof Request;
  protected Response: typeof Response;

  static extendMethod(method: string | string[]) {
    if (Array.isArray(method)) {
      method.forEach(Router.extendMethod);
      return;
    }

    //@ts-ignore
    Router.prototype[method.toLowerCase()] = function (this: Router, ...args: any[]) {
      //@ts-ignore
      return this.route(method, ...args);
    };
  }

  constructor(data?: { Request?: typeof Request, Response?: typeof Response; }) {
    this.Request = data && data.Request || Request;
    this.Response = data && data.Response || Response;
  }

  usePrefix(prefix: string): this {
    if (prefix && prefix[0] !== "/") {
      prefix = "/" + prefix;
    }

    this.prefix = prefix || "";
    return this;
  }

  clone(): Router {
    const router = new Router({
      Request: this.Request,
      Response: this.Response
    });

    router.tlsOptions = this.tlsOptions;

    if (this.middlewares.length) {
      router.middlewares.push(...this.middlewares);
    }
    if (this.errorMiddlewares.length) {
      router.errorMiddlewares.push(...this.errorMiddlewares);
    }
    return router;
  }

  useServer(server: Server | Http2SecureServer): this {
    this.server = server;
    return this;
  }

  tls(options: SecureServerOptions): this {
    this.tlsOptions = options;
    return this;
  }

  handleError(...middlewares: ErrorMiddleware[]): this {
    this.errorMiddlewares.push(...middlewares);
    return this;
  }

  use(...middlewares: [AnyMiddleware, ...AnyMiddleware[]]): this {
    this.middlewares.push(...bindMiddlewares(middlewares));
    return this;
  }

  route(method: string | string[] | undefined, middleware: AnyMiddleware, ...middlewares: AnyMiddleware[]): this;
  route(method: string | string[] | undefined, path: undefined | string | string[], middleware: AnyMiddleware, ...middlewares: AnyMiddleware[]): this;
  route(method: string | string[] | undefined, ...args: [any, ...any[]]): this {
    if (Array.isArray(method)) {
      method.forEach(method => this.route(method, ...args));
      return this;
    }

    const path = typeof args[0] === "function" ? undefined : args.shift();
    if (Array.isArray(path)) {
      path.forEach(path => this.route(method, path, ...args));
      return this;
    }

    const middleware = compose(args);

    if (!path && !method) {
      return this.use(middleware);
    }

    if (method) {
      method = method.toUpperCase();
    }

    if (!path) {
      return this.use((req, res, next) => {
        if (req.method === method) {
          return middleware(req, res, next);
        }

        return next();
      });
    }

    const check = compile(this.prefix + path);

    if (!method) {
      return this.use((req, res, next) => {
        if (req.params = check(req.pathname)) {
          return middleware(req, res, next);
        }

        return next();
      });
    }

    return this.use((req, res, next) => {
      if (req.method === method && (req.params = check(req.pathname))) {
        return middleware(req, res, next);
      }

      return next();
    });
  }

  any(middleware: Middleware): this;
  any(path: string | string[], middleware: Middleware): this;
  any(): this {
    return (this.route as any)(undefined, ...arguments);
  }

  listener(): Middleware {
    const { middlewares, errorMiddlewares } = this;
    const middleware = compose(middlewares);
    const errorMiddleware = errorMiddlewares.length ? composeErrorMiddleware(errorMiddlewares) : defaultErrorHandler;

    const finalize = (res: Response, error?: any) => {
      if (res.bypass || res.finished) {
        return;
      }

      res.statusCode = error ? 500 : 404;
      res.end();
    };

    return (req, res) => {
      res.statusCode = 200;
      req.response = res;
      res.request = req;

      middleware(req, res, e => {
        if (!e) {
          return finalize(res);
        }

        errorMiddleware(e, req, res, finalize.bind(null, res));
      });
    };
  }

  listen(address: string): Promise<CloseListener>;
  listen(port: number): Promise<CloseListener>;
  listen(host: string, port: number): Promise<CloseListener>;
  listen(host: string | number, port?: number): Promise<CloseListener> {
    if (arguments.length === 1) {
      if (typeof host === "number") {
        port = host;
        host = "0.0.0.0";
      } else {
        const sep = host.indexOf(":");
        if (sep === -1) {
          port = 0;
        } else {
          port = parseInt(host.substr(sep + 1)) || 0;
          host = host.substr(0, sep) || "0.0.0.0";
        }
      }
    }

    return new Promise((resolve, reject) => {
      const options = {
        IncomingMessage: this.Request,
        ServerResponse: this.Response
      };

      const server = this.server || (this.tlsOptions ? createSecureServer({
        ...options,
        ...this.tlsOptions
      }) : createServer(options));
      const listener = this.listener();
      server.on("request", listener);
      server.on("error", reject);
      server.listen(port, host as string, () => {
        this.server = server;
        server.removeListener("error", reject);
        const address = server.address() as { address: string, port: number; };

        resolve({
          server,
          host: address.address,
          port: address.port,
          close: () => new Promise<void>((resolve, reject) => {
            server.removeListener("request", listener);
            server.close((err?: Error) => err ? reject(err) : resolve());
          })
        });
      });
    });
  }
}

function bindMiddlewares(middleware: Array<AnyMiddleware>): Middleware[] {
  return middleware.map(middleware => typeof middleware === "function" ? middleware : middleware.middleware.bind(middleware));
}

function defaultErrorHandler(e: any, req: Request, res: Response) {
  if (e) {
    console.error(e);
  }

  if (!res.headersSent) {
    res.statusCode = 500;
  }

  if (!res.finished) {
    res.end();
  }
}

Router.extendMethod(["GET", "POST", "PUT", "PATCH", "HEAD", "OPTIONS", "DELETE", "TRACE", "CONNECT"]);