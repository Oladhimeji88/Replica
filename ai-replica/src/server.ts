/**
 * Process entrypoint: load configuration, wire the app, listen, and shut down
 * cleanly when the platform asks.
 */
import "dotenv/config";

import fsp from "node:fs/promises";
import type { Server } from "node:http";

import { createApp } from "./app.js";
import { ConfigError, loadConfig, type Env } from "./config/env.js";
import { GENERATED_DIR, resolveFromRoot } from "./config/paths.js";
import { createLogger, type Logger } from "./core/logger.js";
import { MediaJanitor } from "./core/media-janitor.js";
import { PersonaLoader } from "./persona/loader.js";
import { createServices } from "./providers/registry.js";

/** How long to let in-flight requests finish before forcing the process down. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // No logger yet, and this is the one message the operator must read.
      process.stderr.write(`\n${error.message}\n\nSee .env.example for the full list.\n\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const logger = createLogger(env);
  await fsp.mkdir(GENERATED_DIR, { recursive: true });

  const persona = new PersonaLoader({
    dir: resolveFromRoot(env.PERSONA_DIR),
    watch: env.PERSONA_WATCH,
    logger,
  });
  await persona.init();

  const services = createServices(env, logger, persona);
  const app = createApp(services);

  const janitor = new MediaJanitor({
    directory: GENERATED_DIR,
    retentionMs: env.MEDIA_RETENTION_MS,
    logger,
  });
  janitor.start();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { url: `http://localhost:${env.PORT}`, env: env.NODE_ENV },
      "AI Replica is listening",
    );
  });

  installShutdownHandlers({ server, persona, janitor, logger });
}

interface ShutdownContext {
  server: Server;
  persona: PersonaLoader;
  janitor: MediaJanitor;
  logger: Logger;
}

function installShutdownHandlers({ server, persona, janitor, logger }: ShutdownContext): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    // Stop accepting connections, then wait for open requests to drain.
    const forced = setTimeout(() => {
      logger.warn("shutdown grace period expired — exiting anyway");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();

    server.close(() => {
      janitor.stop();
      persona.close();
      clearTimeout(forced);
      logger.info("shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // A crash that leaves the process in an unknown state should end it, not
  // limp on serving broken requests. The platform restarts us.
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection");
    process.exit(1);
  });
}

await main();
