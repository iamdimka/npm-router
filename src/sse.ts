import Context from "./context"

export default class SSE {
  protected _connections = new Set<Context>()

  take($: Context) {
    $.bypass = true
    $.res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache"
    })

    this._connections.add($)
  }
}