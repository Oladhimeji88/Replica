/**
 * Free text-to-speech through Microsoft Edge's online voices.
 *
 * This is the zero-cost default: no account, no key, decent quality, but a
 * generic voice that is recognisably not you. It exists so the app is fully
 * usable before anyone signs up for anything — switch `TTS_PROVIDER` to
 * `elevenlabs` when you want your own cloned voice.
 *
 * Requires msedge-tts v2: v1 cannot connect to the current endpoint, which now
 * demands a signed `Sec-MS-GEC` token. See `.npmrc` for why that needs install
 * scripts disabled.
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

import type { Env } from "../../config/env.js";
import { UpstreamError, errorMessage } from "../../core/errors.js";
import type { Logger } from "../../core/logger.js";
import { collectStream } from "../../core/stream.js";
import type { SpeechAudio, TTSProvider } from "../types.js";

export class EdgeTTS implements TTSProvider {
  readonly name = "edge";
  /** Needs no credentials, so it is always available. */
  readonly available = true;
  private readonly log: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "tts", provider: this.name });
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    const tts = new MsEdgeTTS();

    try {
      const started = Date.now();
      await tts.setMetadata(
        this.env.EDGE_TTS_VOICE,
        OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      );

      const { audioStream } = tts.toStream(text);
      const audio = await collectStream(audioStream);

      this.log.debug(
        { characters: text.length, bytes: audio.byteLength, ms: Date.now() - started },
        "speech synthesized",
      );

      return { audio, contentType: "audio/mpeg", extension: "mp3" };
    } catch (error) {
      throw new UpstreamError("Edge TTS", errorMessage(error));
    } finally {
      // Each synthesis opens its own WebSocket; without this they accumulate.
      try {
        tts.close();
      } catch {
        // Nothing to close if the connection never opened.
      }
    }
  }
}
