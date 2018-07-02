import { IncomingMessage, ServerResponse } from "http"
import { createWriteStream, createReadStream, stat } from "fs"
import { parse } from "url"
import { dirname, normalize } from "path"
import { mkdir, KeyValue } from "./util"
import Cookies from "./cookies"

const regexpIP = /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/

export default class Context {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  protected _body?: Promise<Buffer>
  readonly state: KeyValue = {}
  readonly params: KeyValue<string> = {}
  readonly query: KeyValue<string | string[]> = {}
  readonly pathname: string

  bypass?: boolean

  constructor(req: IncomingMessage, res: ServerResponse) {
    this.req = req
    this.res = res

    const { pathname, query } = parse(req.url || "", true)
    this.pathname = normalize(pathname || "/")
    this.query = query as any || {}
  }

  get cookies(): Cookies {
    if (!(this instanceof Context)) {
      throw new Error("Could be get from instance")
    }

    const cookies = new Cookies(this.req, this.res)

    Object.defineProperty(this, "cookies", {
      get() {
        return cookies
      }
    })

    return cookies
  }

  get method(): string {
    return this.req.method || "GET"
  }

  get status(): number {
    return this.res.statusCode
  }

  set status(value: number) {
    this.res.statusCode = value
  }

  get url(): string {
    return this.req.url || ""
  }

  ip(): string | void {
    const ip = `${this.req.headers["x-forwarded-for"]},${this.req.connection.remoteAddress}`.match(regexpIP)
    return ip ? ip[0] : undefined
  }

  body(): Promise<Buffer> {
    return (this._body || (this._body = new Promise<Buffer>((resolve, reject) => {
      if (this.req.method && this.req.method[0] === "P") { // POST, PUT, PATCH
        const chunks: Buffer[] = []

        this.req.on("error", reject)
          .on("data", chunks.push.bind(chunks))
          .on("end", () => resolve(Buffer.concat(chunks)))
        return
      }

      return resolve(Buffer.allocUnsafe(0))
    })))
  }

  setHeader(name: string, value: number | string | string[] | null | void): this {
    if (!this.res.headersSent) {
      if (value == null) {
        this.res.removeHeader(name)
        return this
      }

      this.res.setHeader(name, value)
    }

    return this
  }

  setHeaders(data: KeyValue<number | string | string[]>): this {
    if (!this.res.headersSent) {
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          if (data[key] == null) {
            this.res.removeHeader(key)
            continue
          }

          this.res.setHeader(key, data[key])
        }
      }
    }

    return this
  }

  appendHeader(name: string, value: number | string | string[]): this {
    if (!this.res.headersSent) {
      const header = this.res.getHeader(name)
      if (header) {
        value = (header instanceof Array ? header : [header as string]).concat(value as any)
      }

      this.res.setHeader(name, value)
    }

    return this
  }

  removeHeader(name: string): this {
    if (!this.res.headersSent) {
      this.res.removeHeader(name)
    }

    return this
  }

  file(path: string, contentType?: string | null, force?: boolean): Promise<void> {
    return new Promise((resolve, reject) => stat(path, (err, stats) => {
      if (err) {
        if (err.code === "ENOENT") {
          this.status = 404
          this.end()
          return resolve()
        }

        return reject(err)
      }

      const Etag = `${stats.mtime.getTime().toString(36)}/${stats.size.toString(36)}`
      if (!force && this.req.headers["if-none-match"] === Etag) {
        this.status = 304
        this.end()
        return resolve()
      }

      this.status = 200
      this.setHeaders({
        "Etag": Etag,
        "Content-Length": stats.size
      })

      if (contentType) {
        this.setHeader("Content-Type", contentType)
      }

      createReadStream(path).on("error", reject).on("end", resolve).pipe(this.res)
    }))
  }

  saveTo(path: string): Promise<void> {
    return mkdir(dirname(path), true)
      .then(() => new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(path)
          .on("error", reject)
          .on("close", resolve)

        this.req.pipe(ws)
      }))
  }

  download(data: Buffer, name?: string): void
  download(path: string, name?: string): Promise<void>
  download(pathOrBuffer: string | Buffer, name?: string): void | Promise<void> {
    if (pathOrBuffer instanceof Buffer) {
      this.setHeaders({
        "Content-Type": "application/force-download",
        "Content-Transfer-Encoding": "binary",
        "Content-Disposition": name ? `attachment; filename="${name}"` : "attachment",
        "Content-Length": pathOrBuffer.length
      })

      this.end(pathOrBuffer)
      return
    }

    return new Promise((resolve, reject) =>
      stat(pathOrBuffer, (e, stat) => {
        if (e) {
          return reject(e)
        }

        this.setHeaders({
          "Content-Type": "application/force-download",
          "Content-Transfer-Encoding": "binary",
          "Content-Disposition": name ? `attachment; filename="${name}"` : "attachment",
          "Content-Length": stat.size
        })

        createReadStream(pathOrBuffer).on("error", reject).on("end", resolve).pipe(this.res)
      }))
  }

  send(payload: any, serializer: (value: any, ...rest: any[]) => Buffer | string = JSON.stringify, contentType?: string) {
    if (!contentType && serializer === JSON.stringify) {
      this.setHeader("Content-Type", "application/json")
    }

    return this.end(serializer(payload), true)
  }

  end(body?: string | Buffer, setContentLength: boolean = true): this {
    if (this.res.finished) {
      return this
    }

    if (!body) {
      this.res.end()
      return this
    }

    if (typeof body === "string") {
      body = Buffer.from(body)
    }

    if (!this.res.headersSent) {
      if (setContentLength) {
        this.res.setHeader("Content-Length", body.length)
      }
      this.res.flushHeaders()
    }

    if (this.req.method === "HEAD") {
      this.res.end()
      return this
    }

    this.res.end(body)
    return this
  }
}