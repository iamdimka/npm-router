import { IncomingMessage as HTTPIncomingMessage } from "http";
import { createWriteStream } from "fs";
import { parse, ParsedUrlQuery } from "querystring";
import { promises as fs } from "fs";
import { dirname } from "path";
import Cookies from "./Cookies";
import ServerResponse from "./Response";
import { normalize } from "path";

const regexpIP = /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/;
const empty = Buffer.allocUnsafe(0);

export default class Request extends HTTPIncomingMessage {
  response!: ServerResponse;
  protected _body?: Promise<Buffer>;
  params?: { [key: string]: string; } | boolean;
  readonly context: { [key: string]: any; } = {};
  body: any = undefined;

  get cookies(): Cookies {
    const value = new Cookies(this, this.response);
    Object.defineProperty(this, "cookies", { value });
    return value;
  }

  get parsedURL() {
    let { url } = this;
    let value;
    let idx;

    if (!url) {
      url = "/";
    } else if (url[0] !== "/") {
      url = `/${url}`;
    }

    if (url.includes("./")) {
      url = normalize(url);
    }

    if ((idx = url.indexOf("?", 1)) < 0) {
      value = {
        pathname: url
      };
    } else {
      value = {
        pathname: url.substring(0, idx),
        query: url.substring(idx + 1)
      };
    };

    Object.defineProperty(this, "parsedURL", { value });
    return value;
  }

  get pathname() {
    return this.parsedURL.pathname;
  }

  get query(): ParsedUrlQuery {
    const { query } = this.parsedURL;
    const value = query ? parse(query) : {};
    Object.defineProperty(this, "query", { value });
    return value;
  }

  ip(): string | undefined {
    const ip = `${this.headers["x-forwarded-for"]},${this.connection.remoteAddress}`.match(regexpIP);
    return ip ? ip[0] : undefined;
  }

  readBody(force?: boolean): Promise<Buffer> {
    return (this._body || (this._body = new Promise<Buffer>((resolve, reject) => {
      if (force || (this.method && this.method[0] === "P") || (this.headers["content-length"] && this.headers["content-length"] !== "0")) { // POST, PUT, PATCH
        const chunks: Buffer[] = [];

        this.on("error", reject)
          .on("data", chunks.push.bind(chunks))
          .on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : empty));
        return;
      }

      return resolve(empty);
    })));
  }

  async saveTo(path: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    if (this._body) {
      const body = await this._body;
      fs.writeFile(path, body);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.pipe(createWriteStream(path)
        .on("error", reject)
        .on("close", resolve));
    });
  }
}