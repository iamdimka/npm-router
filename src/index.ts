import { Server, createServer } from "http";
import { createSecureServer, SecureServerOptions, Http2SecureServer } from "http2";
import Cookies, { CookieOptions } from "./Cookies";
import compile from "./matchPath";
import { compose } from "./util";
import Request from "./Request";
import Response from "./Response";

export { Request, Response, Cookies, CookieOptions };

export interface Middleware {
  (request: Request, response: Response, next: () => void): any;
}

export interface CloseListener {
  host: string;
  port: number;
  server: Server | Http2SecureServer;
  close(): Promise<void>;
}

interface Method {
  (method: string | undefined, middleware: Middleware): this;
  (method: string | undefined, path: string | string[], middleware: Middleware): this;
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
  protected readonly _middlewares: Middleware[] = [];
  protected _tlsOptions?: SecureServerOptions;
  protected _server?: Server | Http2SecureServer;
  protected _prefix: string = "";
  protected _handleError: (e: any, request: Request, response: Response) => any = defaultErrorHandler;

  usePrefix(prefix: string): this {
    if (prefix && prefix[0] !== "/") {
      prefix = "/" + prefix;
    }

    this._prefix = prefix || "";
    return this;
  }

  clone(): Router {
    const router = new Router();
    router._tlsOptions = this._tlsOptions;
    router._handleError = this._handleError;
    router._middlewares.push(...this._middlewares);
    return router;
  }

  server(server: Server | Http2SecureServer): this {
    this._server = server;
    return this;
  }

  tls(options: SecureServerOptions): this {
    this._tlsOptions = options;
    return this;
  }

  handleError(handler: (e: any, request: Request, response: Response) => any): this {
    this._handleError = handler;
    return this;
  }

  use(...middlewares: Middleware[]): this {
    this._middlewares.push(...middlewares);
    return this;
  }

  route(method: string | undefined, ...middlewares: [Middleware, ...Middleware[]]): this;
  route(method: string | undefined, path: string | string[], ...middlewares: [Middleware, ...Middleware[]]): this;
  route(): this {
    if (typeof arguments[1] === "function") {
      const [method, ...middlewares] = arguments;
      const middleware = compose(...middlewares as [Middleware, ...Middleware[]]);
      if (!method) {
        return this.use(middleware);
      }

      return this.use((req, res, next) => {
        if (req.method !== method) {
          return next();
        }

        return middleware(req, res, next);
      });
    }

    const [method, path, ...middlewares] = arguments;
    const middleware = compose(...middlewares as [any, ...any[]]);

    if (Array.isArray(path)) {
      path.forEach(path => this.route(method, path, middleware));
      return this;
    }

    const check = compile(this._prefix + path);

    if (method) {
      return this.use((req, res, next) => {
        if (req.method !== method) {
          return next();
        }

        if (req.params = check(req.pathname)) {
          return middleware(req, res, next);
        }

        return next();
      });
    }

    return this.use((req, res, next) => {
      if (req.params = check(req.pathname)) {
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
    const { _middlewares: middlewares, _handleError } = this;
    let length = middlewares.length;

    middlewares.push = (...items) => {
      return length = Array.prototype.push.apply(middlewares, items);
    };

    function router(req: Request, res: Response): Promise<void> {
      let i = -1;

      return run(0);

      function run(n: number): Promise<any> {
        if (i >= n) {
          return Promise.reject(new Error("Stop to call next()"));
        }

        i = n;
        if (n >= length) {
          return Promise.resolve();
        }

        try {
          return Promise.resolve(middlewares[n](req, res, run.bind(null, n + 1)));
        } catch (e) {
          return Promise.reject(e);
        }
      }
    };

    const finalize = (req: Request, res: Response) => {
      if (res.bypass || res.finished) {
        return;
      }

      res.statusCode = 404;
      res.end();
    };

    return (req, res) => {
      res.statusCode = 200;

      router(req, res)
        .then(() => finalize(req, res))
        .catch(e => _handleError(e, req, res));
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
        IncomingMessage: Request,
        ServerResponse: Response
      };

      const server = this._server || (this._tlsOptions ? createSecureServer({
        ...options,
        ...this._tlsOptions
      }) : createServer(options));
      const listener = this.listener();
      server.on("request", listener);
      server.on("error", reject);
      server.listen(port, host as string, () => {
        this._server = server;
        server.removeListener("error", reject);
        const address = server.address() as { address: string, port: number; };

        resolve({
          server,
          host: address.address,
          port: address.port,
          close() {
            return new Promise<void>((resolve, reject) => {
              server.removeListener("request", listener);
              server.close((err?: Error) => err ? reject(err) : resolve());
            });
          }
        });
      });
    });
  }
}

function defaultErrorHandler(e: any, req: Request, res: Response) {
  console.error(e);

  if (!res.headersSent) {
    res.statusCode = 500;
  }

  if (!res.finished) {
    res.end();
  }
}

void ["GET", "POST", "PUT", "PATCH", "HEAD", "OPTIONS", "DELETE", "TRACE", "CONNECT"].forEach(method => {
  //@ts-ignore
  Router.prototype[method.toLowerCase()] = function () {
    return (this.route as any)(method, ...arguments);
  };
});