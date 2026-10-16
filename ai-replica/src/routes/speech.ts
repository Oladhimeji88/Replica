/**
 * Voice endpoints: text in, audio out; audio in, text out.
 *
 * Both are optional — if no provider is configured the browser's built-in
 * speech APIs still work, they just sound generic and only transcribe reliably
 * in Chrome and Edge.
 */
import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import type { Env } from "../config/env.js";
import { BadRequestError, ProviderUnavailableError } from "../core/errors.js";
import { validateBody } from "../middleware/validate.js";
import type { Services } from "../providers/registry.js";

const MAX_TTS_CHARS = 5_000;

const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TTS_CHARS),
});

function createUploader(env: Env): ReturnType<typeof multer> {
  return multer({
    // Clips are seconds long and forwarded straight to a vendor, so memory is
    // the right store — no temp files to clean up or leak.
    storage: multer.memoryStorage(),
    limits: { fileSize: env.STT_MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (file.mimetype.startsWith("audio/") || file.mimetype === "video/webm") {
        callback(null, true);
        return;
      }
      callback(new BadRequestError(`Unsupported upload type: ${file.mimetype}`));
    },
  });
}

export function createSpeechRouter(services: Services): Router {
  const router = Router();
  const { tts, stt, env } = services;
  const upload = createUploader(env);

  /** Synthesize speech for arbitrary text — used by the browser for playback. */
  router.post("/tts", validateBody(ttsRequestSchema), async (req, res) => {
    if (!tts?.available) {
      throw new ProviderUnavailableError("Text-to-speech", "no provider is configured");
    }

    const { text } = req.body as z.infer<typeof ttsRequestSchema>;
    const speech = await tts.synthesize(text);

    res.setHeader("Content-Type", speech.contentType);
    res.setHeader("Content-Length", speech.audio.byteLength);
    res.setHeader("Cache-Control", "no-store");
    res.send(speech.audio);
  });

  /** Transcribe a recorded clip. Field name: `audio`. */
  router.post("/transcribe", upload.single("audio"), async (req, res) => {
    if (!stt?.available) {
      throw new ProviderUnavailableError(
        "Speech-to-text",
        "no provider is configured — the browser's own recogniser is being used instead",
      );
    }
    if (!req.file) {
      throw new BadRequestError('Expected an audio file in the "audio" field');
    }

    const transcription = await stt.transcribe(
      req.file.buffer,
      req.file.mimetype || "audio/webm",
    );
    res.json({ text: transcription.text, confidence: transcription.confidence });
  });

  return router;
}
