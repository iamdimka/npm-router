import { STATUS_CODES } from "http";

export default class HTTPError extends Error {
  static is(error: any): error is HTTPError {
    return error != null && error instanceof HTTPError;
  }

  constructor(readonly code: number, message?: string) {
    super(message || (code in STATUS_CODES ? STATUS_CODES[code] : ""));
  }
}

export const RequestTooLarge = new HTTPError(413, "Request too large");