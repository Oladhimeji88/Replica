/**
 * Operational endpoints: liveness, readiness, persona introspection, and the
 * capability list the browser uses to decide which features to switch on.
 */
import { Router } from "express";

import type { Services } from "../providers/registry.js";

/** Rough token estimate — about four characters per token for English prose. */
function approximateTokens(bytes: number): number {
  return Math.round(bytes / 4);
}

export function createSystemRouter(services: Services): Router {
  const router = Router();
  const { llm, tts, stt, avatar, persona, env } = services;

  /** Liveness: is the process up? Used by orchestrators to decide on restarts. */
  router.get("/health/live", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });

  /**
   * Readiness: can it actually serve traffic? Without a language model the app
   * has nothing to say, so that is the one hard requirement.
   */
  router.get("/health/ready", (_req, res) => {
    const providers = {
      llm: { name: llm.name, available: llm.available },
      tts: tts ? { name: tts.name, available: tts.available } : null,
      stt: stt ? { name: stt.name, available: stt.available } : null,
      avatar: avatar ? { name: avatar.name, available: avatar.available } : null,
    };

    const ready = llm.available;
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ready" : "degraded", providers });
  });

  /**
   * What the frontend is allowed to do. Lets one static page work whether or
   * not the paid providers are switched on, with no hardcoded assumptions.
   */
  router.get("/api/capabilities", (_req, res) => {
    res.json({
      streaming: true,
      tts: tts?.available ? tts.name : null,
      stt: stt?.available ? stt.name : null,
      avatar: avatar?.available ? avatar.name : null,
      model: env.CLAUDE_MODEL,
    });
  });

  /** Confirms your persona files are being read, and how large they have grown. */
  router.get("/api/persona/status", (_req, res) => {
    const snapshot = persona.current();
    res.json({
      files: snapshot.files,
      bytes: snapshot.bytes,
      approxTokens: approximateTokens(snapshot.bytes),
      hash: snapshot.hash,
      loadedAt: snapshot.loadedAt,
      preview: snapshot.content.slice(0, 300),
    });
  });

  /** Force a re-read, for when the file watcher is off or missed an edit. */
  router.post("/api/persona/reload", async (_req, res) => {
    const snapshot = await persona.reload();
    res.json({ files: snapshot.files, bytes: snapshot.bytes, hash: snapshot.hash });
  });

  return router;
}
