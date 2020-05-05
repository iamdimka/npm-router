import { ServerResponse as HTTPServerResponse } from "http";
import { stat, createReadStream } from "fs";
import IncomingMessage from "./Request";
import Cookies from "./Cookies";

export default class Response extends HTTPServerResponse {
  request!: IncomingMessage;

  protected _cookies?: Cookies;

  get cookies(): Cookies {
    const value = this.request.cookies;
    Object.defineProperty(this, "cookies", { value });
    return value;
  }

  bypass?: boolean;

  setHeaders(data: { [key: string]: number | string | string[]; }): this {
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

  download(data: Buffer, name?: string): void;
  download(path: string, name?: string): Promise<void>;
  download(pathOrBuffer: string | Buffer, name?: string): void | Promise<void> {
    if (pathOrBuffer instanceof Buffer) {
      this.setHeaders({
        "Content-Type": "application/force-download",
        "Content-Transfer-Encoding": "binary",
        "Content-Disposition": name ? `attachment; filename="${name}"` : "attachment",
        "Content-Length": pathOrBuffer.length
      });

      this.end(pathOrBuffer);
      return;
    }

    return new Promise((resolve, reject) =>
      stat(pathOrBuffer, (e, stat) => {
        if (e) {
          return reject(e);
        }

        this.setHeaders({
          "Content-Type": "application/force-download",
          "Content-Transfer-Encoding": "binary",
          "Content-Disposition": name ? `attachment; filename="${name}"` : "attachment",
          "Content-Length": stat.size
        });

        createReadStream(pathOrBuffer)
          .on("error", reject)
          .on("end", resolve)
          .pipe(this);
      }));
  }

  async file(path: string, contentType?: string | null, force?: boolean): Promise<void> {
    return new Promise((resolve, reject) =>
      stat(path, (err, stats) => {
        if (err) {
          if (err.code === "ENOENT") {
            this.statusCode = 404;
            this.end();
            return resolve();
          }

          return reject(err);
        }

        const Etag = `${stats.mtime.getTime().toString(36)}/${stats.size.toString(36)}`;
        if (!force && this.request.headers["if-none-match"] === Etag) {
          this.statusCode = 304;
          this.end();
          return resolve();
        }

        this.statusCode = 200;
        this.setHeaders({
          "Etag": Etag,
          "Content-Length": stats.size
        });

        if (contentType) {
          this.setHeader("Content-Type", contentType);
        }

        createReadStream(path)
          .on("error", reject)
          .on("end", resolve)
          .pipe(this);
      }));
  }

  json(payload: any) {
    return this.send(payload, JSON.stringify, "application/json");
  }

  send(payload: any, serializer: (value: any, ...rest: any[]) => Buffer | string = JSON.stringify, contentType?: string) {
    if (!contentType && serializer === JSON.stringify) {
      this.setHeader("Content-Type", "application/json");
    }

    return this.finalize(serializer(payload), true);
  }

  finalize(body?: string | Buffer, setContentLength: boolean = true): this {
    if (this.finished) {
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