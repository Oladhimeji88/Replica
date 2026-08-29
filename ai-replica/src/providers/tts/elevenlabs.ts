/**
 * ElevenLabs text-to-speech.
 *
 * This is the provider to use if you want the replica to sound like *you*:
 * clone your voice once in the ElevenLabs dashboard, then set
 * `ELEVENLABS_VOICE_ID` to that voice.
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { Env } from "../../config/env.js";
import {
  ProviderUnavailableError,
  UpstreamError,
  errorMessage,
} from "../../core/errors.js";
import type { Logger } from "../../core/logger.js";
import { collectStream } from "../../core/stream.js";
import type { SpeechAudio, TTSProvider } from "../types.js";

export class ElevenLabsTTS implements TTSProvider {
  readonly name = "elevenlabs";
  private readonly client: ElevenLabsClient | undefined;
  private readonly voiceId: string | undefined;
  private readonly log: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "tts", provider: this.name });
    this.voiceId = env.ELEVENLABS_VOICE_ID;
    this.client = env.ELEVENLABS_API_KEY
      ? new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY })
      : undefined;
  }

  get available(): boolean {
    return this.client !== undefined && this.voiceId !== undefined;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SpeechAudio> {
    if (!this.client || !this.voiceId) {
      throw new ProviderUnavailableError(
        "ElevenLabs",
        "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must both be set",
      );
    }

    try {
      const started = Date.now();
      const stream = await this.client.textToSpeech.convert(
        this.voiceId,
        {
          text,
          modelId: this.env.ELEVENLABS_MODEL_ID,
          outputFormat: "mp3_44100_128",
        },
        { abortSignal: signal },
      );

      const audio = await collectStream(stream);
      this.log.debug(
        { characters: text.length, bytes: audio.byteLength, ms: Date.now() - started },
        "speech synthesized",
      );

      return { audio, contentType: "audio/mpeg", extension: "mp3" };
    } catch (error) {
      throw new UpstreamError("ElevenLabs", errorMessage(error));
    }
  }
}
