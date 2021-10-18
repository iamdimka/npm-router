import { createReadStream, stat } from "fs";
import { fileStats, responseEncoding } from "./util";

import Cookies from "./Cookies";
import { ServerResponse as HTTPServerResponse } from "http";
import Request from "./Request";
import { pipeline } from "stream";

export default class Response extends HTTPServerResponse {
  request!: Request;
  bypass?: boolean;

  encodeResponse?: boolean | Array<"gzip" | "deflate" | "br">;

  get context(): Request["context"] {
    const value = this.request.context;
    Object.defineProperty(this, "context", { value });
    return value;
  }

  get cookies(): Cookies {
    const value = this.request.cookies;
    Object.defineProperty(this, "cookies", { value });
    return value;
  }

  status(code: number, message?: string): this {
    this.statusCode = code;
    if (message != null) {
      this.statusMessage = message;
    }

    return this;
  }

  setHeaders(data: Record<string, number | string | string[]>): this {
    if (!this.headersSent) {
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          if (data[key] == null) {
            this.removeHeader(key);
            continue;
          }

          this.setHeader(key, data[key]);
        }
      }
    }

    return this;
  }

  appendHeader(name: string, value: number | string | string[]): this {
    if (!this.headersSent) {
      const header = this.getHeader(name);
      if (header) {
        value = (header instanceof Array ? header : [header as string]).concat(value as any);
      }

      this.setHeader(name, value);
    }

    return this;
  }

  async download(pathOrBuffer: string | Buffer, name?: string): Promise<void> {
    this.setHeaders({
      "Content-Type": "application/force-download",
      "Content-Transfer-Encoding": "binary",
      "Content-Disposition": name ? `attachment; filename="${name}"` : "attachment"
    });

    if (pathOrBuffer instanceof Buffer) {
      this.setHeader("Content-Length", pathOrBuffer.length);
      this.end(pathOrBuffer);
      return;
    }

    const stat = await fileStats(pathOrBuffer);
    this.setHeader("Content-Length", stat.size);

    return new Promise<void>((resolve, reject) =>
      createReadStream(pathOrBuffer)
        .on("error", reject)
        .on("end", resolve)
        .pipe(this)
    );
  }

  redirect(url: string, statusCode = 301) {
    this.writeHead(statusCode || 301, {
      Location: url
    });

    this.end();
    return this;
  }

  async file(path: string, contentType?: string | null, force?: boolean): Promise<void> {
    let stat;
    try {
      stat = await fileStats(path);
    } catch (e: any) {
      if (e.code === "ENOENT" || e.code === "ENOTDIR") {
        this.statusCode = 404;
        this.end();
        return;
      }

      this.statusCode = 503;
      this.end();
      return Promise.reject(e);
    }

    const Etag = `${stat.mtime.getTime().toString(36)}/${stat.size.toString(36)}`;
    if (!force && this.request.headers["if-none-match"] === Etag) {
      this.statusCode = 304;
      this.end();
      return;
    }

    this.statusCode = 200;
    this.setHeader("Etag", Etag);

    if (contentType) {
      this.setHeader("Content-Type", contentType);
    }

    if (this.request.method === "HEAD") {
      this.setHeader("Content-Length", stat.size);
      this.end();
      return;
    }

    if (this.encodeResponse !== false) {
      const encoding = responseEncoding(this.request.acceptEncoding, this.encodeResponse === true ? undefined : this.encodeResponse);

      if (encoding) {
        this.setHeader("Content-Encoding", encoding.encoding);

        return new Promise((resolve, reject) => {
          pipeline(createReadStream(path), encoding, this, err => err ? reject(err) : resolve());
        });
      }
    }

    this.setHeader("Content-Length", stat.size);
    return new Promise((resolve, reject) => {
      createReadStream(path)
        .on("error", reject)
        .on("end", resolve)
        .pipe(this);
    });
  }

  html(paylod: string | Buffer) {
    this.setHeader("Content-Type", "text/html");
    return this.finalize(paylod, true);
  }

  json(payload: any, pretty?: number) {
    this.setHeader("Content-Type", "application/json");
    payload = JSON.stringify(payload, null, pretty);
    return this.finalize(payload, true);
  }

  send(payload: any, serializer: (value: any, ...rest: any[]) => Buffer | string = JSON.stringify, contentType?: string) {
    if (contentType) {
      this.setHeader("Content-Type", contentType);
    } else if (serializer === JSON.stringify) {
      this.setHeader("Content-Type", "application/json");
    }

    return this.finalize(serializer(payload), true);
  }

  finalize(body?: string | Buffer, setContentLength: boolean = true): this {
    if (this.writableEnded) {
      return this;
    }

    if (!body) {
      this.end();
      return this;
    }

    if (typeof body === "string") {
      body = Buffer.from(body);
    }

    if (!this.headersSent) {
      if (this.encodeResponse !== false) {
        const encoding = responseEncoding(this.request.acceptEncoding, this.encodeResponse === true ? undefined : this.encodeResponse);

        if (encoding) {
          this.bypass = true;
          this.setHeader("Content-Encoding", encoding.encoding);
          pipeline(encoding, this, (err) => {
            if (err != null) {
              console.error(err);
              this.end();
            }
          });
          encoding.write(body);
          encoding.flush();
          return this;
        }
      }

      if (setContentLength) {
        this.setHeader("Content-Length", body.length);
      }

      this.flushHeaders();
    }

    if (this.request.method === "HEAD") {
      this.end();
      return this;
    }

    this.end(body);
    return this;
  }
}