/**
 * Speech-to-text via Deepgram.
 *
 * This talks to Deepgram's REST API directly rather than through their SDK.
 * The endpoint is a single POST with the audio as the raw body and has been
 * stable for years, whereas the JavaScript SDK has been rewritten across major
 * versions more than once — not a dependency worth carrying for one call.
 */
import type { Env } from "../../config/env.js";
import {
  ProviderUnavailableError,
  UpstreamError,
  errorMessage,
} from "../../core/errors.js";
import type { Logger } from "../../core/logger.js";
import type { STTProvider, Transcription } from "../types.js";

const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";
const REQUEST_TIMEOUT_MS = 30_000;

/** The subset of Deepgram's response this provider reads. */
interface DeepgramResponse {
  results?: {
    channels?: {
      alternatives?: { transcript?: string; confidence?: number }[];
    }[];
  };
}

export class DeepgramSTT implements STTProvider {
  readonly name = "deepgram";
  private readonly log: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "stt", provider: this.name });
  }

  get available(): boolean {
    return Boolean(this.env.DEEPGRAM_API_KEY);
  }

  async transcribe(
    audio: Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<Transcription> {
    const apiKey = this.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new ProviderUnavailableError("Deepgram", "DEEPGRAM_API_KEY is not set");
    }

    const url = new URL(DEEPGRAM_ENDPOINT);
    url.searchParams.set("model", this.env.DEEPGRAM_MODEL);
    // Punctuation and casing, so the transcript reads like a written question.
    url.searchParams.set("smart_format", "true");

    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      const started = Date.now();
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": mimeType || "audio/webm",
        },
        body: new Uint8Array(audio),
        signal: combined,
      });
      this.log.debug(
        { bytes: audio.byteLength, ms: Date.now() - started },
        "audio transcribed",
      );
    } catch (error) {
      throw new UpstreamError("Deepgram", errorMessage(error), 504);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new UpstreamError(
        "Deepgram",
        `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const body = (await response.json()) as DeepgramResponse;
    const best = body.results?.channels?.[0]?.alternatives?.[0];

    return {
      text: (best?.transcript ?? "").trim(),
      confidence: best?.confidence,
    };
  }
}
