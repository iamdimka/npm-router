export default class HTTPError extends Error {
  constructor(readonly code: number, message?: string) {
    super(message || "");
  }
}

export const RequestTooLarge = new HTTPError(413, "Request too large");