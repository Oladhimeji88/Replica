/**
 * The single place an error becomes an HTTP response.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so routes never need their own try/catch just to avoid an unhandled rejection.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";

import { AppError, isAppError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorBody = {
    error: { code: "not_found", message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  const log = logger.child({ component: "http" });

  return (error, req, res, next) => {
    // Headers already sent means a stream was mid-flight; let Express close it.
    if (res.headersSent) {
      next(error);
      return;
    }

    const appError = normalise(error);

    if (appError.statusCode >= 500) {
      log.error(
        { err: error, method: req.method, path: req.path },
        "request failed unexpectedly",
      );
    } else {
      log.warn(
        {
          code: appError.code,
          message: appError.message,
          method: req.method,
          path: req.path,
        },
        "request rejected",
      );
    }

    const body: ErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details === undefined ? {} : { details: appError.details }),
      },
    };
    res.status(appError.statusCode).json(body);
  };
}

/**
 * Anything that is not already an `AppError` is an unexpected failure. Its real
 * message is logged but never returned, so internals cannot leak to clients.
 */
function normalise(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "The audio clip is larger than the configured limit"
        : `Upload rejected: ${error.message}`;
    return new AppError(message, 413, "upload_rejected");
  }

  // express.json() raises this for malformed JSON bodies.
  if (error instanceof SyntaxError && "body" in error) {
    return new AppError("Request body is not valid JSON", 400, "bad_request");
  }

  return new AppError("Something went wrong on our end", 500, "internal_error");
}
