/**
 * Chat endpoints.
 *
 * `POST /api/chat`        — one request, one complete reply (plus an optional
 *                           talking-face clip). Kept for compatibility.
 * `POST /api/chat/stream` — the same reply as Server-Sent Events, so the UI can
 *                           show words as they arrive instead of waiting for the
 *                           whole answer. This is the path the browser uses.
 */
import { Router } from "express";
import { z } from "zod";

import { errorMessage } from "../core/errors.js";
import { validateBody } from "../middleware/validate.js";
import { buildSystemPrompt } from "../persona/prompt.js";
import type { Services } from "../providers/registry.js";

/** Guard rails so one request cannot pin the process or blow the context window. */
const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 8_000;

/** How often to poke an idle SSE connection so proxies keep it open. */
const HEARTBEAT_MS = 15_000;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

const chatRequestSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1).max(MAX_MESSAGES),
    useFace: z.boolean().optional().default(false),
  })
  .refine((body) => body.messages.at(-1)?.role === "user", {
    message: "the last message must come from the user",
    path: ["messages"],
  })
  .refine((body) => body.messages[0]?.role === "user", {
    message: "the conversation must start with a user message",
    path: ["messages"],
  });

type ChatRequestBody = z.infer<typeof chatRequestSchema>;

export function createChatRouter(services: Services): Router {
  const router = Router();
  const { llm, tts, avatar, persona, logger } = services;
  const log = logger.child({ route: "chat" });

  /**
   * Renders a talking-face clip for a finished reply. Never throws: the face is
   * a bonus, so a failure downgrades to text rather than losing the answer.
   */
  async function renderFace(
    text: string,
  ): Promise<{ videoUrl?: string; faceError?: string }> {
    if (!avatar?.available) {
      return { faceError: "the talking-face provider is not configured" };
    }
    if (!tts?.available) {
      return { faceError: "a text-to-speech provider is required to animate the face" };
    }

    try {
      const speech = await tts.synthesize(text);
      const video = await avatar.render(speech);
      return { videoUrl: video.videoUrl };
    } catch (error) {
      log.warn({ err: error }, "talking-face rendering failed — falling back to text");
      return { faceError: errorMessage(error) };
    }
  }

  router.post("/chat", validateBody(chatRequestSchema), async (req, res) => {
    const { messages, useFace } = req.body as ChatRequestBody;

    const completion = await llm.complete({
      messages: messages,
      system: buildSystemPrompt(persona.current()),
    });

    const face = useFace ? await renderFace(completion.text) : {};

    res.json({
      reply: completion.text,
      usage: completion.usage,
      model: completion.model,
      ...face,
    });
  });

  router.post("/chat/stream", validateBody(chatRequestSchema), async (req, res) => {
    const { messages, useFace } = req.body as ChatRequestBody;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx and friends not to buffer the stream into uselessness.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Rendering a talking face can take minutes of silence, which idle proxies
    // read as a dead connection. An SSE comment keeps it open and is ignored by
    // the client.
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), HEARTBEAT_MS);

    // If the user closes the tab, stop paying for tokens nobody will read.
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    try {
      const generator = llm.stream({
        messages: messages,
        system: buildSystemPrompt(persona.current()),
        signal: abort.signal,
      });

      let result = await generator.next();
      while (!result.done) {
        send("delta", { text: result.value });
        result = await generator.next();
      }
      const completion = result.value;

      if (useFace) {
        send("status", { message: "rendering talking face" });
        const face = await renderFace(completion.text);
        if (face.videoUrl) send("video", { videoUrl: face.videoUrl });
        else if (face.faceError) send("face_error", { message: face.faceError });
      }

      send("done", {
        reply: completion.text,
        usage: completion.usage,
        model: completion.model,
      });
    } catch (error) {
      if (abort.signal.aborted) {
        log.debug("client disconnected mid-stream");
      } else {
        log.error({ err: error }, "streaming reply failed");
        send("error", { message: errorMessage(error) });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  return router;
}
