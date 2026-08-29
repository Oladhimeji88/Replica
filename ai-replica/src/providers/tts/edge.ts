/**
 * Free text-to-speech through Microsoft Edge's online voices.
 *
 * This is the zero-cost default: no account, no key, decent quality, but a
 * generic voice that is recognisably not you. It exists so the app is fully
 * usable before anyone signs up for anything — switch `TTS_PROVIDER` to
 * `elevenlabs` when you want your own cloned voice.
 *
 * The library writes to a file rather than returning bytes, so synthesis goes
 * through the OS temp directory and is cleaned up immediately after reading.
 */
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

import type { Env } from "../../config/env.js";
import { UpstreamError, errorMessage } from "../../core/errors.js";
import type { Logger } from "../../core/logger.js";
import type { SpeechAudio, TTSProvider } from "../types.js";

export class EdgeTTS implements TTSProvider {
  readonly name = "edge";
  private readonly log: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "tts", provider: this.name });
  }

  /** Needs no credentials, so it is always available. */
  get available(): boolean {
    return true;
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    const scratch = path.join(tmpdir(), `ai-replica-${randomUUID()}.mp3`);

    try {
      const started = Date.now();
      const tts = new MsEdgeTTS();
      await tts.setMetadata(
        this.env.EDGE_TTS_VOICE,
        OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      );

      // Use the path the library reports rather than the one we asked for —
      // it may adjust the extension to match the output format.
      const written = (await tts.toFile(scratch, text)) || scratch;
      const audio = await fsp.readFile(written);

      this.log.debug(
        { characters: text.length, bytes: audio.byteLength, ms: Date.now() - started },
        "speech synthesized",
      );

      await fsp.rm(written, { force: true });
      return { audio, contentType: "audio/mpeg", extension: "mp3" };
    } catch (error) {
      await fsp.rm(scratch, { force: true }).catch(() => undefined);
      throw new UpstreamError("Edge TTS", errorMessage(error));
    }
  }
}
