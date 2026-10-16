/**
 * Express application factory.
 *
 * Kept separate from `server.ts` so tests can mount the app in-process with
 * supertest and never bind a port.
 */
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { corsOrigins, type Env } from "./config/env.js";
import { GENERATED_DIR, PUBLIC_DIR } from "./config/paths.js";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler.js";
import type { Services } from "./providers/registry.js";
import { createChatRouter } from "./routes/chat.js";
import { createSpeechRouter } from "./routes/speech.js";
import { createSystemRouter } from "./routes/system.js";

function securityHeaders(env: Env): ReturnType<typeof helmet> {
  return helmet({
    // The bundled UI is a single self-contained page: its CSS and JS are
    // inline, it loads no third-party code, and it plays media this app serves.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Same-origin only would block the <video> element from a different host;
    // this app serves its own media, so the stricter default is fine.
    crossOriginEmbedderPolicy: false,
    hsts: env.NODE_ENV === "production",
  });
}

function corsMiddleware(env: Env): ReturnType<typeof cors> {
  const origins = corsOrigins(env);
  // No allowlist means the page and the API share an origin, which is the
  // normal deployment — so send no CORS headers at all rather than `*`.
  return cors(
    origins.length > 0 ? { origin: origins, credentials: true } : { origin: false },
  );
}

export function createApp(services: Services): Express {
  const { env, logger } = services;
  const app = express();

  // Behind Render/Railway/Fly the client IP is in X-Forwarded-For; the rate
  // limiter needs this to be right or it buckets every user together.
  app.set("trust proxy", env.TRUST_PROXY ? 1 : false);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      // Health checks would otherwise dominate the log at one line per probe.
      autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false },
    }),
  );
  app.use(securityHeaders(env));
  app.use(corsMiddleware(env));
  app.use(express.json({ limit: "1mb" }));

  // Rate limiting protects the wallet as much as the server: every chat request
  // costs real money at the model, the voice, and the avatar.
  app.use(
    "/api",
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: {
        error: {
          code: "rate_limited",
          message: "Too many requests — slow down a moment.",
        },
      },
    }),
  );

  app.use(createSystemRouter(services));
  app.use("/api", createChatRouter(services));
  app.use("/api", createSpeechRouter(services));

  // Generated clips are one-shot and personal: never let a CDN or browser keep
  // them, and never let the directory be listed.
  app.use(
    "/generated",
    express.static(GENERATED_DIR, {
      index: false,
      setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
    }),
  );
  app.use(express.static(PUBLIC_DIR, { index: "index.html" }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
