import { ParsedUrlQuery, parse } from "querystring";

import Cookies from "./Cookies";
import { IncomingMessage as HTTPIncomingMessage } from "http";
import ServerResponse from "./Response";
import { createWriteStream } from "fs";
import { dirname } from "path";
import { promises as fs } from "fs";
import { isIP } from "net";
import { normalize } from "path";
import { readBody } from "./util";

const empty = Buffer.allocUnsafe(0);

export default class Request extends HTTPIncomingMessage {
  response!: ServerResponse;
  protected _body?: Promise<Buffer>;
  params?: Record<string, string> | boolean;
  readonly context: Record<string, any> = {};
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

  get acceptEncoding(): string[] {
    let value = this.headers["accept-encoding"] || [];
    if (typeof value === "string") {
      let idx = value.indexOf(";");
      if (idx >= 0) {
        value = value.substring(0, idx);
      }

      value = value.split(",").map(encoding => encoding.trim());
    }

    Object.defineProperty(this, "acceptEncoding", { value });
    return value;
  }

  acceptsEncoding(encoding: string) {
    return this.acceptEncoding.includes(encoding);
  }

  ip(): string | undefined {
    let ip = this.headers["x-real-ip"] as string;
    if (isIP(ip)) {
      return ip;
    }

    ip = this.headers["x-proxyuser-ip"] as string;
    if (isIP(ip)) {
      return ip;
    }

    ip = this.headers["x-forwarded-for"] as string;
    if (ip) {
      const idx = ip.indexOf(",");
      ip = idx < 0 ? ip.trim() : ip.substring(0, idx).trim();

      if (isIP(ip)) {
        return ip;
      }
    }

    return this.socket.remoteAddress;
  }

  readBody(maxBodySize: number = Infinity, force?: boolean): Promise<Buffer> {
    if (this._body) {
      return this._body;
    }

    if (force || (this.method && this.method[0] === "P") || ("content-length" in this.headers && this.headers["content-length"] !== "0")) { // POST, PUT, PATCH
      return this._body = readBody(this, maxBodySize);
    }

    return this._body = Promise.resolve(empty);
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