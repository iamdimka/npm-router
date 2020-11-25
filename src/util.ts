import { mkdir as md } from "fs";
import { dirname } from "path";
import { Middleware, ErrorMiddleware } from "./Router";
import type { IncomingMessage } from "http";
import { RequestTooLarge } from "./HTTPError";

const emptyBuffer = Buffer.allocUnsafe(0);

export interface KeyValue<Value = any> {
  [key: string]: Value;
}

export function mkdir(path: string, recurse?: boolean): Promise<boolean> {
  return new Promise((resolve, reject) =>
    md(path, e => {
      if (e) {
        switch (e.code) {
          case "EEXIST":
            return resolve(false);

          case "ENOENT":
            if (!recurse) {
              return reject(e);
            }

            const parent = dirname(path);
            if (parent === path) {
              return reject(e);
            }

            return resolve(mkdir(parent, true).then(() => mkdir(path)));

          default:
            return reject(e);
        }
      }

      resolve(true);
    }));
}

export function compose(fns: Middleware[]): Middleware {
  let l = fns.length;
  if (l < 2) {
    return fns[0];
  }

  return (req, res, next) => {
    let i = 0;
    const loop = (e?: Error) => !e && (i < l) ? fns[i++](req, res, loop) : next(e);
    return loop();
  };
};

export function composeErrorMiddleware(fns: ErrorMiddleware[]): ErrorMiddleware {
  let l = fns.length;
  if (l < 2) {
    return fns[0];
  }

  return (error, req, res, next) => {
    let i = 0;
    const loop = (e?: Error) => {
      if (e) {
        error = e;
      }

      return (i < l) ? fns[i++](error, req, res, loop) : next(error);
    };
    return loop();
  };
};

export function readBody(req: IncomingMessage, maxBodySize: number = Infinity): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let done = false;

    req
      .on("data", chunk => {
        maxBodySize -= chunk.length;

        if (maxBodySize < 0) {
          if (!done) {
            done = true;
            req.resume();
            reject(RequestTooLarge);
          }

          return;
        }

        chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => done || resolve(chunks.length ? Buffer.concat(chunks) : emptyBuffer));
  });
}