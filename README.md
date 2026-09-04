# Royalway One

**Everything you need. One workspace.**

A unified web workspace for PDFs, documents, images, audio, video, transcription
and AI. No sign-in, no payments, no API keys for users — every tool works
anonymously and files are deleted automatically.

A Royalway Media product.

---

## The one rule

**No fake functionality.** Every visible tool really works. Real PDF processing,
real FFmpeg media handling, real OCR, real speech-to-text, real AI. Compression
statistics come from measuring actual files. Progress states are truthful —
indeterminate when the duration genuinely is not known. When a provider is not
configured, the affected tool says so plainly rather than pretending.

## What is inside

| Area | Tools |
|---|---|
| **PDF & documents** | Compress (Extreme / Recommended / High Quality / Custom), merge, split, extract / remove / organise / rotate pages, protect, unlock, page numbers, watermark, crop, repair, OCR, sign, redact, and conversions to and from Word, Excel, PowerPoint, JPG, PNG, HTML |
| **Images** | Compress, convert, resize, crop, rotate & flip, strip metadata |
| **Audio** | Convert, compress, trim, merge, volume, speed, reverse, extract from video, browser recorder |
| **Video** | Compress, convert, trim, merge, resize, crop, rotate, speed, volume, add audio, add text, add image, loop, stabilise, screen & camera recorder |
| **Transcription** | Upload or public media URL → timestamped, speaker-labelled transcript you can edit and search → export TXT, DOCX, PDF, SRT, VTT, MD |
| **AI Workspace** | Summarise, executive summary, key points, action items, decisions, explain, rewrite, extract, translate, Ask Document (grounded RAG chat), compare documents |
| **Business tools** | Meeting minutes, follow-up email, SWOT, project brief, decision log, proposal analysis, policy summary, document review, job description, report summary, spreadsheet insights |
| **Workflows** | Chain tools into one click: recording → transcript → summary → minutes → follow-up email |

## Quick start

```bash
npm install
npm run dev          # API on :8080, Vite dev server on :5173
```

Production build:

```bash
npm run build        # builds client then server
npm start            # serves the API and the built frontend on one port
```

### Switching on AI and transcription

Create `server/.env` (gitignored):

```bash
OPENAI_API_KEY=sk-your-key        # AI tools + Whisper transcription
# DEEPGRAM_API_KEY=your-key       # optional: better speaker diarization
```

One OpenAI key switches on everything. Confirm with:

```bash
curl localhost:8080/api/capabilities   # {"ai":true,"transcription":true,...}
```

Without keys, everything else still works and the AI/transcription pages state
clearly that they are not switched on. See **[ENVIRONMENT.md](ENVIRONMENT.md)**.

## Architecture at a glance

A modular monolith: one Express + TypeScript server, one React + Vite frontend,
optional Postgres, optional dedicated worker. No Kubernetes, Kafka, RabbitMQ,
Celery or Redis.

```
client/   React 19 + Vite SPA
server/   Express API, tool registry, job queue, provider abstractions
```

Every tool is a registry entry with an `id`, clean `route`, accepted types and a
`run()` function, so the navigation, search, SEO routes and API stay in sync
from a single source of truth.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** and **[API.md](API.md)**.

## Documentation

| Document | Contents |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deploying to Render, including provider credentials |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Every environment variable |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system fits together |
| [API.md](API.md) | HTTP API reference |
| [SECURITY.md](SECURITY.md) | Threat model and protections |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common problems and fixes |

## Testing

```bash
npm test                    # unit + integration (vitest)
```

## Privacy

No accounts. An anonymous session cookie exists only to track your jobs and own
your files. Downloads use expiring HMAC-signed links. Files are deleted
automatically after `FILE_RETENTION_MINUTES` (default two hours). Analytics are
anonymous counters with no file names, contents or identifiers.

## Licence

© Royalway Media. All rights reserved.
