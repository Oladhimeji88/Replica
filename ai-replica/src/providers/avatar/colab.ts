/**
 * Talking-face rendering through the SadTalker notebook in `colab/`.
 *
 * The notebook exposes a single `POST /generate` endpoint over an ngrok tunnel
 * and returns an MP4. This provider owns the awkward parts of that: a long,
 * explicit timeout (a free Colab GPU takes minutes), and writing the result
 * somewhere the browser can fetch it.
 *
 * To add a hosted alternative — D-ID, HeyGen — drop a sibling file implementing
 * `AvatarProvider` and register it in `registry.ts`. Nothing else changes.
 */
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import type { Env } from "../../config/env.js";
import {
  ProviderUnavailableError,
  TimeoutError,
  UpstreamError,
  errorMessage,
} from "../../core/errors.js";
import type { Logger } from "../../core/logger.js";
import type { AvatarProvider, RenderedVideo, SpeechAudio } from "../types.js";

export interface ColabAvatarOptions {
  /** Absolute path of the directory served at `/generated`. */
  outputDir: string;
}

export class ColabAvatar implements AvatarProvider {
  readonly name = "colab";
  private readonly log: Logger;

  constructor(
    private readonly env: Env,
    private readonly options: ColabAvatarOptions,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "avatar", provider: this.name });
  }

  get available(): boolean {
    return Boolean(this.env.COLAB_API_URL);
  }

  async render(speech: SpeechAudio, signal?: AbortSignal): Promise<RenderedVideo> {
    const baseUrl = this.env.COLAB_API_URL;
    if (!baseUrl) {
      throw new ProviderUnavailableError(
        "Talking face",
        "COLAB_API_URL is not set — start the notebook and paste its ngrok URL",
      );
    }

    const timeoutMs = this.env.AVATAR_TIMEOUT_MS;
    // Abort on either the caller giving up or our own ceiling being reached.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const form = new FormData();
    form.append(
      "audio",
      new Blob([new Uint8Array(speech.audio)], { type: speech.contentType }),
      `speech.${speech.extension}`,
    );

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, "")}/generate`, {
        method: "POST",
        body: form,
        signal: combined,
      });
    } catch (error) {
      if (timeoutSignal.aborted)
        throw new TimeoutError("Talking-face rendering", timeoutMs);
      throw new UpstreamError("Colab renderer", errorMessage(error), 504);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new UpstreamError(
        "Colab renderer",
        `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const video = Buffer.from(await response.arrayBuffer());
    const filename = `${randomUUID()}.mp4`;
    await fsp.mkdir(this.options.outputDir, { recursive: true });
    await fsp.writeFile(path.join(this.options.outputDir, filename), video);

    this.log.info(
      { bytes: video.byteLength, ms: Date.now() - started },
      "talking-face clip rendered",
    );
    return { videoUrl: `/generated/${filename}`, bytes: video.byteLength };
  }
}
