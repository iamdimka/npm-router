import Response from "./Response";

export default class SSE {
  protected id = 0;
  protected connections = new Set<Response>();
  protected history: Array<{ id: number, data: string; }>;
  protected pos = 0;
  protected historySize: number;

  constructor(historySize = 0) {
    this.historySize = historySize;
    this.history = new Array(historySize);
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

    this.connections.add(res);

    res.on("close", () => {
      this.connections.delete(res);
    });

    if (!this.historySize)
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

    for (let i = this.pos; i < this.historySize; i++) {
      const item = this.history[i];
      if (item && item.id > id) {
        res += item.data;
      }
    }

    for (let i = 0; i < this.pos; i++) {
      const item = this.history[i];
      if (item && item.id > id) {
        res += item.data;
      }
    }

    return res;
  }

  protected enqueue(data: string) {
    const id = ++this.id;
    data += `\nid: ${id}\n\n`;

    if (this.historySize) {
      const pos = (this.pos++) % this.historySize;
      const entry = this.history[pos] || { id, data };
      entry.id = id;
      entry.data = data;
    }

    this.connections.forEach(res => res.write(data));
  }

  event(event: string, data?: any) {
    this.enqueue(`event: ${event}${data ? `\ndata: ${JSON.stringify(data)}` : ""}`);
  }

  send(data: any) {
    this.enqueue(`data: ${JSON.stringify(data)}`);
  }

  close() {
    this.connections.forEach(res => res.end());
  }
}