import { ErrorMiddleware, Middleware } from "./Router";
import { Stats, promises as fs } from "fs";
import { Zlib, createBrotliCompress, createDeflate, createGzip } from "zlib";

import type { IncomingMessage } from "http";
import { RequestTooLarge } from "./HTTPError";
import type { Transform } from "stream";

const emptyBuffer = Buffer.allocUnsafe(0);

export const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".css": "text/css",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

export interface KeyValue<Value = any> {
  [key: string]: Value;
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

export function asyncCompose(fns: Middleware[]): Middleware {
  let l = fns.length;
  if (l < 2) {
    return fns[0];
  }

  return (req, res, next) => {
    let i = 0;
    const loop = async (e?: Error) => {
      if (e || i >= l) {
        return next(e);
      }

      try {
        await fns[i++](req, res, loop);
      } catch (e: any) {
        return next(e);
      }
    };
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

export function staticMiddleware(params: {
  dir: string;
  mimes?: Record<string, string>;
  index?: string;
  routePath?: (path: string) => string;
}): Middleware {
  const index = params.index ? (params.index[0] === "/" ? params.index.substr(1) : params.index) : "index.html";
  const mimes = params.mimes || mimeTypes;
  const dir = params.dir.endsWith("/") ? params.dir.slice(0, -1) : `${params.dir}`;
  const routePath = params.routePath || (path => path);

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    let path = req.pathname;
    if (path.endsWith("/")) {
      path += index;
    }
    path = routePath(path);

    const idx = path.lastIndexOf(".");
    if (idx < 0) {
      return next();
    }

    const contentType = mimes[path.substring(idx)];
    if (!contentType) {
      return next();
    }

    return res.file(dir + path, contentType);
  };
}

export function responseEncoding(accepts: string[], prefer?: string[]): Transform & Zlib & { encoding: string; } | undefined {
  if (!accepts.length) {
    return;
  }

  for (const encoding of accepts) {
    if (prefer && !prefer.includes(encoding)) {
      continue;
    }

    switch (encoding) {
      case "gzip":
        return Object.assign(createGzip(), { encoding: "gzip" });

      case "deflate":
        return Object.assign(createDeflate(), { encoding: "deflate" });

      case "br":
        return Object.assign(createBrotliCompress(), { encoding: "br" });
    }
  }
}

const pendingStats = new Map<string, Promise<Stats>>();

export async function fileStats(path: string): Promise<Stats> {
  let pending = pendingStats.get(path);
  if (!pending) {
    pending = fs.stat(path);
    pendingStats.set(path, pending);
    pending.finally(() => pendingStats.delete(path));
  }

  return pending;
}