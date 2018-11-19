import Context from "./context"

export default class SSE {
  protected _id = 0
  protected _connections = new Set<Context>()
  protected _history: Array<{ id: number, data: string }>
  protected _pos = 0
  protected _historySize: number

  constructor(historySize = 0) {
    this._historySize = historySize
    this._history = new Array(historySize)
  }

  take($: Context) {
    $.bypass = true
    $.res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    })
    $.res.write("\n\n")
    $.req.socket.setNoDelay(true)

    this._connections.add($)

    $.res.on("close", () => {
      this._connections.delete($)
    })

    if (!this._historySize)
      return

    // @ts-ignore
    const lastEventID: number = parseInt($.req.headers["last-event-id"], 10)
    if (lastEventID) {
      const events = this.eventsSince(lastEventID)
      if (events) {
        $.res.write(events)
      }
    }
  }

  protected eventsSince(id: number): string {
    let res: string = ""

    for (let i = this._pos; i < this._historySize; i++) {
      const item = this._history[i]
      if (item && item.id > id) {
        res += item.data
      }
    }

    for (let i = 0; i < this._pos; i++) {
      const item = this._history[i]
      if (item && item.id > id) {
        res += item.data
      }
    }

    return res
  }

  protected enqueue(data: string, event?: string) {
    const id = ++this._id
    data += `\nid: ${id}\n\n`

    if (this._historySize) {
      const pos = (this._pos++) % this._historySize
      this._history[pos] = { id, data }
    }

    this._connections.forEach($ => $.res.write(data))
  }

  event(event: string, data?: any) {
    this.enqueue(`event: ${event}${data ? `\ndata: ${JSON.stringify(data)}` : ""}`, event)
  }

  send(data: any) {
    this.enqueue(`data: ${JSON.stringify(data)}`)
  }

  close() {
    this._connections.forEach($ => $.res.end())
  }
}