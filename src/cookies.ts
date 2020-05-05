import { IncomingMessage, ServerResponse } from "http";

export interface CookieOptions {
  domain?: string;
  path?: string;
  expires?: Date;
  secure?: boolean;
  httpOnly?: boolean;
  maxAge?: number;
  applyInCurrentSession?: boolean;
}

export default class Cookies {
  static readonly defaultOptions = {
    path: "/",
    httpOnly: true
  };

  readonly req: IncomingMessage;
  readonly res: ServerResponse;

  options: CookieOptions = Object.create(Cookies.defaultOptions);

  protected _parsedCookies?: { [key: string]: string; };
  protected _set?: string[];

  constructor(req: IncomingMessage, res: ServerResponse) {
    this.req = req;
    this.res = res;
  }

  getParsedCookies() {
    if (!this._parsedCookies) {
      const cookies: { [key: string]: string; } = this._parsedCookies = {};

      if (this.req.headers.cookie) {
        (this.req.headers.cookie as string).split(/;\s?/).map(record => {
          const [key, value] = record.split("=");
          cookies[decodeURIComponent(key)] = decodeURIComponent(value);
        });
      }
    }

    return this._parsedCookies;
  }

  set(name: string, value: string, options?: CookieOptions) {
    const opts: CookieOptions = Object.create(this.options);

    if (options) {
      Object.assign(opts, options);
    }

    if (!value) {
      value = "";
      opts.expires = new Date(0);
    }

    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    if (opts.domain) {
      cookie += `; Domain=${opts.domain}`;
    }

    if (opts.path) {
      cookie += `; Path=${opts.path}`;
    }

    if (opts.expires) {
      cookie += `; Expires=${opts.expires.toUTCString()}`;
    }

    if (opts.maxAge) {
      cookie += `; Max-Age=${opts.maxAge}`;
    }

    if (opts.secure) {
      cookie += "; Secure";
    }

    if (opts.httpOnly) {
      cookie += "; HttpOnly";
    }

    if (!this._set) {
      this._set = [];
    }

    this._set.push(cookie);
    this.res.setHeader("Set-Cookie", this._set);

    if (opts.applyInCurrentSession) {
      this.getParsedCookies()[name] = value;
    }
    return this;
  }

  get(key: string): string | undefined {
    return this.getParsedCookies()[key];
  }
}