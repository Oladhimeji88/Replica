# AI Replica

A web app that answers chat and voice questions **as you**, based on your own
writing and Q&A. Powered by the Claude API, with optional voice cloning,
server-side transcription, and a lip-synced talking face.

---

## What it does

```
Browser (public/index.html)
   |  mic -> MediaRecorder -> POST /api/transcribe -> Deepgram / Whisper
   |         (or the browser's own SpeechRecognition when no key is set)
   |  text -> POST /api/chat/stream
   v
Node server (src/)
   |  persona/*.md -> cached system prompt (prompt-cached at Anthropic)
   |  -> Claude, streamed back token by token over SSE
   |  -> POST /api/tts -> ElevenLabs (your cloned voice) or free Edge voices
   |  -> optional: audio -> SadTalker on Colab -> talking-face MP4
   v
Browser: renders the reply as it arrives, then speaks or plays it
```

Every external capability sits behind an interface in `src/providers/`. Each one
has a free default and a paid upgrade, and the app runs with **no keys except
the Anthropic one** — features switch themselves on as you add credentials.

| Capability | Free default | Paid upgrade | Env var |
| --- | --- | --- | --- |
| Language model | — | Claude (required) | `ANTHROPIC_API_KEY` |
| Text to speech | Microsoft Edge voices | ElevenLabs voice cloning | `TTS_PROVIDER` |
| Speech to text | Browser `SpeechRecognition` | Deepgram or OpenAI Whisper | `STT_PROVIDER` |
| Talking face | off | SadTalker on a free Colab GPU | `AVATAR_PROVIDER` |

The browser asks `GET /api/capabilities` on load and adapts, so the same page
works in every configuration without edits.

---

## Quick start

Requires **Node.js 20.11 or newer**.

```bash
cd ai-replica
npm install
cp .env.example .env      # then paste your key into .env
npm run dev
```

Open <http://localhost:3000>.

If configuration is wrong the server refuses to start and prints exactly which
variable is at fault, rather than failing later on the first request.

Then fill in your persona — the files in `persona/`:

- `bio.md` — who you are, factually
- `faq.md` — real Q&A in your own words (**this matters most** for sounding like you)
- `how_i_talk.md` — tone and phrasing habits

Add as many `.md` or `.txt` files as you like; everything in `persona/` is loaded
automatically, and edits are picked up without a restart. Check what is loaded at
<http://localhost:3000/api/persona/status>.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server, restarts on change |
| `npm start` | Runs the compiled build (`npm run build` first) |
| `npm run build` | Type-checks and compiles `src/` to `dist/` |
| `npm run typecheck` | Types only, no output |
| `npm run lint` | ESLint, including type-aware rules |
| `npm run format` | Prettier, write mode |
| `npm test` | Vitest suite |
| `npm run test:coverage` | Suite plus a coverage report |
| `npm run check` | Everything CI runs, in one command |

---

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat/stream` | Chat, streamed as Server-Sent Events. What the UI uses. |
| `POST` | `/api/chat` | Chat, single JSON response. Simpler to script against. |
| `POST` | `/api/tts` | Text in, audio bytes out. |
| `POST` | `/api/transcribe` | Multipart audio (field `audio`) in, text out. |
| `GET` | `/api/capabilities` | Which providers are switched on. |
| `GET` | `/api/persona/status` | Files loaded, size, content hash. |
| `POST` | `/api/persona/reload` | Force a re-read from disk. |
| `GET` | `/health/live` | Process is up. For restart policies. |
| `GET` | `/health/ready` | Can serve traffic; per-provider detail. 503 when degraded. |

Request and response shapes:

```bash
# Non-streaming
curl -X POST localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"What do you care about?"}]}'

# -> {"reply":"...","usage":{...},"model":"claude-opus-5"}
```

The streaming endpoint takes the same body and emits these events:

| Event | Payload | Meaning |
| --- | --- | --- |
| `delta` | `{ text }` | The next fragment of the reply. |
| `status` | `{ message }` | Progress note, e.g. the face is rendering. |
| `video` | `{ videoUrl }` | A talking-face clip is ready. |
| `face_error` | `{ message }` | The face failed; the text answer still stands. |
| `done` | `{ reply, usage, model }` | Complete. |
| `error` | `{ message }` | The turn failed. |

Errors everywhere use one shape: `{ "error": { "code", "message", "details? } }`.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example) and validated at
boot by `src/config/env.ts`. The ones worth knowing about:

| Variable | Default | Notes |
| --- | --- | --- |
| `CLAUDE_MODEL` | `claude-opus-5` | Any current model id. |
| `CLAUDE_EFFORT` | `low` | `low` … `max`. Spoken replies are short, so `low` keeps them fast. Raise if answers feel shallow. |
| `CLAUDE_MAX_TOKENS` | `2048` | Replies are read aloud; long ones are rarely wanted. |
| `TTS_PROVIDER` | `edge` | `elevenlabs` \| `edge` \| `none` |
| `STT_PROVIDER` | `none` | `deepgram` \| `openai` \| `none` |
| `AVATAR_PROVIDER` | `none` | `colab` \| `none` |
| `RATE_LIMIT_MAX` | `30` | Requests per minute per IP across `/api`. |
| `MEDIA_RETENTION_MS` | `3600000` | Generated face clips are deleted after an hour. |
| `TRUST_PROXY` | `false` | Set to `true` behind Render / Railway / Fly / nginx. |

---

## Sounding like your actual voice (ElevenLabs)

The default Edge voices are free and clear, but generic. To use your own:

1. Clone your voice at <https://elevenlabs.io> (a few minutes of clean audio).
2. Copy the voice ID from the voice library.
3. Set in `.env`:

```env
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

`ELEVENLABS_MODEL_ID` defaults to `eleven_turbo_v2_5`, which is tuned for low
latency. Switch to a quality-first model if you prefer fidelity over speed.

## Transcription that works outside Chrome

`STT_PROVIDER=none` leaves transcription to the browser: free, but only reliable
in Chrome and Edge. Setting `deepgram` or `openai` moves it server-side, so the
mic works in Safari and Firefox too and accuracy improves noticeably. Both are
pay-per-minute and cost cents per session.

---

## Talking face

Your reply text becomes speech, and your photo is animated to it — mouth, head
movement, blinking — via **SadTalker** on a free Google Colab GPU.

SadTalker animates the head and face only, no hands or body. Full-body avatars
need a paid API (HeyGen, D-ID, Synthesia) or a much heavier open-source pipeline.

**Setup:**

1. Get a free ngrok account at <https://ngrok.com> and copy your authtoken.
2. Upload `colab/sadtalker_server.ipynb` to <https://colab.research.google.com/>.
3. Runtime → Change runtime type → **GPU (T4)**.
4. Run the cells top to bottom:
   - Cell 1 installs SadTalker and its models (3–5 min)
   - Cell 2 asks for a photo — clear, front-on, well-lit, neutral expression
   - Cell 3 defines the API
   - Cell 4 takes your ngrok token and prints a public URL
5. Put that URL in `.env` and switch the provider on:

```env
AVATAR_PROVIDER=colab
COLAB_API_URL=https://xxxx.ngrok-free.app
```

6. Restart the server. A **Talking face** checkbox appears in the header.

**What to expect:**

- Each clip takes roughly **1–3 minutes** on Colab's shared free GPU.
- `USE_ENHANCER = True` in Cell 3 improves face quality but costs more time.
  Leave it off while testing.
- Colab's free tier idles out after about 90 minutes. Re-run the cells; the
  ngrok URL changes, so update `.env` again.
- If anything fails — Colab down, checkbox off, timeout — the reply still
  arrives as text and audio. The face is never allowed to lose you the answer.
- Generated clips are video of your face. They are deleted automatically after
  `MEDIA_RETENTION_MS` and are git-ignored.

To add a hosted avatar API instead, write a class implementing `AvatarProvider`
in `src/providers/avatar/` and add one `case` to `src/providers/registry.ts`.
Nothing else in the app changes.

---

## Deploying

```bash
docker build -t ai-replica .
docker run -p 3000:3000 --env-file .env ai-replica
```

The image is multi-stage: no compiler, no dev dependencies, no TypeScript
source. It runs as a non-root user under `tini`, so `SIGTERM` reaches Node and
in-flight requests drain before exit.

Without Docker, any Node host works — Render, Railway, Fly.io:

```bash
npm ci && npm run build && npm start
```

Set `ANTHROPIC_API_KEY` as an environment variable on the host. Never commit
`.env`. Set `TRUST_PROXY=true` so rate limiting sees real client IPs.

`.github/workflows/ci.yml` runs formatting, linting, typechecking, tests with
coverage, the build, and a Docker build that boots the image and probes
`/health/live`.

---

## Cost and scale

The persona corpus is sent with every request, so it is marked for **prompt
caching**: the cached prefix costs roughly a tenth of normal input tokens and
cuts latency. `usage` in every chat response reports `cacheReadTokens` — if it
stays at zero across consecutive requests, something is changing the prompt
prefix between calls.

Caching keeps the current design viable to roughly 20–30k words of persona
notes. Past that, either trim `persona/` to your most representative content, or
move to retrieval: embed the notes as chunks and include only the most relevant
ones per question. That is a meaningful upgrade and worth doing once you
actually hit the limit.

---

## Privacy

Your persona files contain personal information and are sent to the Claude API
as context on every request. If the talking face is on, your audio and photo
also reach the Colab notebook you are running. Don't put anything in `persona/`
you would not want sent over those APIs.

---

## Project layout

```
src/
  config/      env validation (zod) and filesystem paths
  core/        logger, error types, stream helpers, media cleanup
  middleware/  request validation, error handling
  persona/     corpus loader (cached, hot-reloading) and prompt builder
  providers/   one folder per capability, each behind an interface
    llm/       anthropic
    tts/       elevenlabs, edge
    stt/       deepgram, openai
    avatar/    colab
    registry.ts  the only file that knows which vendor is in use
  routes/      chat, speech, system
  app.ts       express wiring: helmet, cors, rate limiting, logging
  server.ts    boot, listen, graceful shutdown
tests/         vitest suite, run against fake providers
```

### Notes on two dependency choices

- **`msedge-tts` is pinned to `^1.3.4`.** Version 2 added a `preinstall` hook
  (`npx only-allow pnpm`) that makes `npm install` fail outright.
- **Deepgram is called over REST rather than through their SDK.** It is a single
  POST with the audio as the body; their JavaScript SDK has been rewritten
  across major versions more than once, which is not worth carrying for one call.
