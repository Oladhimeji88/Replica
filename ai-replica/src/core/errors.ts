/**
 * Error types the HTTP layer knows how to translate into responses.
 *
 * Anything that is not an `AppError` is treated as an unexpected bug: it is
 * logged at `error` level with a stack, and the client gets a generic 500 with
 * no internal detail leaked.
 */

export class AppError extends Error {
  /** Marks errors we anticipated, as opposed to programming mistakes. */
  readonly expected = true;

  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "bad_request", details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(message, 413, "payload_too_large");
  }
}

/** A feature was called but its provider is switched off or missing credentials. */
export class ProviderUnavailableError extends AppError {
  constructor(provider: string, reason: string) {
    super(`${provider} is not available: ${reason}`, 503, "provider_unavailable");
  }
}

/** An upstream vendor (Anthropic, ElevenLabs, Deepgram, Colab) failed. */
export class UpstreamError extends AppError {
  constructor(provider: string, message: string, statusCode = 502) {
    super(`${provider} request failed: ${message}`, statusCode, "upstream_error");
  }
}

export class TimeoutError extends AppError {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms}ms`, 504, "timeout");
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Narrow an unknown thrown value to a message without losing information. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
