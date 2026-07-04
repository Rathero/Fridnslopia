import type { NextFunction, Request, Response } from 'express';

/** An error carrying an HTTP status, thrown by handlers for clean 4xx replies. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Convenience for the common 400 case. */
export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

/** Convenience for the common 404 case. */
export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wrap an async route handler so rejected promises reach the error middleware. */
export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
