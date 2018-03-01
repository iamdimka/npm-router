import { IncomingMessage, ServerResponse } from "http"
import { createWriteStream, createReadStream, stat } from "fs"
import { parse } from "url"
import { dirname } from "path"
import { mkdir } from "./util"

export default class Context<Ctx = void> {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  readonly ctx: Ctx
  protected _body?: Promise<Buffer>
  readonly state: { [key: string]: any } = {}
  readonly params: { [key: string]: string } = {}
  readonly query: { [key: string]: string | string[] } = {}
  readonly pathname: string

  bypass?: boolean

  constructor(req: IncomingMessage, res: ServerResponse, ctx?: Ctx) {
    this.req = req
    this.res = res
    this.ctx = ctx!

    const { pathname, query } = parse(req.url || "", true)
    this.pathname = pathname || ""
    this.query = query || {}
  }

  get method() {
    return this.req.method
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

  setHeader(name: string, value: number | string | string[]): this {
    if (!this.res.headersSent) {
      this.res.setHeader(name, value)
    }

    return this
  }

  setHeaders(data: { [name: string]: number | string | string[] }): this {
    if (this.res.headersSent) {
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          this.res.setHeader(name, data[key])
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
    this.setHeaders({
      "Content-Type": "application/force-download",
      "Content-Transfer-Encoding": "binary",
      "Content-Disposition": name ? `attachment; filename="${name}"` : "attachment",
      "Content-Length": pathOrBuffer.length
    })

    if (pathOrBuffer instanceof Buffer) {
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

  end(body?: string | Buffer): this {
    if (this.res.finished) {
      return this
    }

    if (!this.res.headersSent) {
      this.res.flushHeaders()
    }

    if (!body) {
      this.res.end()
      return this
    }

    if (this.req.method === "HEAD") {
      this.res.end()
      return this
    }

    this.res.end(body)
    return this
  }
}