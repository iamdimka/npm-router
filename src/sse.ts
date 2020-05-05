import Response from "./Response";

export default class SSE {
  protected _id = 0;
  protected _connections = new Set<Response>();
  protected _history: Array<{ id: number, data: string; }>;
  protected _pos = 0;
  protected _historySize: number;

  constructor(historySize = 0) {
    this._historySize = historySize;
    this._history = new Array(historySize);
  }

  take(res: Response) {
    res.bypass = true;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    res.write("\n\n");
    res.socket.setNoDelay(true);

    this._connections.add(res);

    res.on("close", () => {
      this._connections.delete(res);
    });

    if (!this._historySize)
      return;

    // @ts-ignore
    const lastEventID: number = parseInt(res.request.headers["last-event-id"], 10);
    if (lastEventID) {
      const events = this.eventsSince(lastEventID);
      if (events) {
        res.write(events);
      }
    }
  }

  protected eventsSince(id: number): string {
    let res: string = "";

    for (let i = this._pos; i < this._historySize; i++) {
      const item = this._history[i];
      if (item && item.id > id) {
        res += item.data;
      }
    }

    for (let i = 0; i < this._pos; i++) {
      const item = this._history[i];
      if (item && item.id > id) {
        res += item.data;
      }
    }

    return res;
  }

  protected enqueue(data: string) {
    const id = ++this._id;
    data += `\nid: ${id}\n\n`;

    if (this._historySize) {
      const pos = (this._pos++) % this._historySize;
      const entry = this._history[pos] || { id, data };
      entry.id = id;
      entry.data = data;
    }

    this._connections.forEach(res => res.write(data));
  }

  event(event: string, data?: any) {
    this.enqueue(`event: ${event}${data ? `\ndata: ${JSON.stringify(data)}` : ""}`);
  }

  send(data: any) {
    this.enqueue(`data: ${JSON.stringify(data)}`);
  }

  close() {
    this._connections.forEach(res => res.end());
  }
}