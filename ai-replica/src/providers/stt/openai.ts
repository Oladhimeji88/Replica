/**
 * Speech-to-text via OpenAI Whisper.
 *
 * Server-side transcription replaces the browser's `SpeechRecognition` API,
 * which only really works in Chrome and Edge. Doing it here means the mic works
 * in Safari and Firefox too, and accuracy is markedly better.
 */
import OpenAI, { toFile } from "openai";

import type { Env } from "../../config/env.js";
import {
  ProviderUnavailableError,
  UpstreamError,
  errorMessage,
} from "../../core/errors.js";
import type { Logger } from "../../core/logger.js";
import type { STTProvider, Transcription } from "../types.js";

/** Whisper infers the codec from the extension, so give it a plausible one. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

export class OpenAISTT implements STTProvider {
  readonly name = "openai";
  private readonly client: OpenAI | undefined;
  private readonly log: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "stt", provider: this.name });
    this.client = env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
      : undefined;
  }

  get available(): boolean {
    return this.client !== undefined;
  }

  async transcribe(
    audio: Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<Transcription> {
    if (!this.client) {
      throw new ProviderUnavailableError("OpenAI Whisper", "OPENAI_API_KEY is not set");
    }

    const baseMime = mimeType.split(";")[0]?.trim() ?? "audio/webm";
    const extension = EXTENSION_BY_MIME[baseMime] ?? "webm";

    try {
      const started = Date.now();
      const file = await toFile(audio, `speech.${extension}`, { type: baseMime });
      const result = await this.client.audio.transcriptions.create(
        { file, model: this.env.OPENAI_STT_MODEL },
        { signal },
      );

      this.log.debug(
        { bytes: audio.byteLength, ms: Date.now() - started },
        "audio transcribed",
      );
      return { text: result.text.trim() };
    } catch (error) {
      throw new UpstreamError("OpenAI Whisper", errorMessage(error));
    }
  }
}
