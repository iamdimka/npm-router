import { mkdir as md } from "fs";
import { dirname } from "path";
import { Middleware } from "./index";
import compile from "./matchPath";

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

export function compose(...fn: [Middleware, ...Middleware[]]): Middleware {
  let l = fn.length;
  if (l === 1) {
    return fn[0];
  }

  return async (req, res, next) => {
    let i = 0;
    let loop = () => (i < l) ? fn[i++](req, res, loop) : next();
    return loop();
  };
};
