/**
 * Structured logging. One logger instance for the process; route and provider
 * modules derive child loggers so every line carries its origin.
 */
import { pino, type Logger } from "pino";

import type { Env } from "../config/env.js";

/**
 * Anything matching these paths is replaced with `[redacted]` before a log line
 * is written, so an accidental `logger.info({ headers })` cannot leak a key.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  "apiKey",
  "api_key",
  "*.apiKey",
  "*.api_key",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "DEEPGRAM_API_KEY",
  "OPENAI_API_KEY",
];

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">): Logger {
  const pretty = env.NODE_ENV === "development";

  return pino({
    level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          },
        }
      : {}),
  });
}

export type { Logger };
