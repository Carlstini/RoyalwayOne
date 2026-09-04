# Troubleshooting

## "AI features are not switched on for this deployment yet"

No AI provider key is configured. Set `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`)
and restart. Verify:

```bash
curl localhost:8080/api/capabilities   # expect "ai": true
```

Still false?

- Check the exact variable name — `OPENAI_API_KEY`, not `OPENAI_KEY`.
- On Render, set it on the `royalway-one` service and wait for the redeploy to
  finish. (There is a single service, so there is only one place to set it.)
- Look for `ai: not configured` in the logs at boot.

## "Transcription is not switched on"

Set `DEEPGRAM_API_KEY`, or rely on `OPENAI_API_KEY` (Whisper). One OpenAI key
covers AI *and* transcription.

## Transcription jobs stay queued forever

Nothing is draining the queue. Check `RUN_WORKER`: on Render it must be `true`,
because the single web service processes its own jobs. If you have set it to
`false` without running a separate worker, jobs will queue forever.

If you *are* running a separate worker service, it must share both the job queue
(`DATABASE_URL` set on both processes — the JSON fallback is per-process) **and**
the file storage. On Render a persistent disk cannot be mounted by two services,
so a disk-backed worker will fail with "One of your files is no longer
available." That topology requires shared object storage.

## "The AI service is busy right now"

The provider returned 429 or 5xx and retries were exhausted — usually an account
rate limit or a provider incident. Wait and retry; check your provider dashboard
for quota.

## "The AI request took too long"

The document was very large or the provider was slow. Lower
`AI_MAX_INPUT_CHARS`, or split the document. Note the app truncates oversized
input and tells you it did rather than silently dropping content.

## "We could not find any readable text in this file"

The PDF is a scan with no text layer. Run **PDF → OCR** first, then the AI tool.

## "We could not read this PDF. It may be damaged."

Try **PDF → Repair**. If the file is encrypted, run **PDF → Unlock** with the
password first.

## Uploads fail with 413 or "file is too large"

Raise `MAX_UPLOAD_BYTES`. Behind a proxy, also raise that proxy's own body
limit — otherwise it rejects the request before the app sees it.

## Video jobs fail or the service restarts mid-encode

Almost always out of memory. Use a larger instance; video encoding on Render's
`starter` plan will OOM on large files. Reduce `WORKER_CONCURRENCY` to 1 if
several heavy jobs overlap.

## Office conversions produce simplified layout

LibreOffice is not installed, so library-based fallbacks are used. Install
LibreOffice and set `SOFFICE_PATH` for full fidelity. The tools still work
without it.

## Download links return "This link has expired"

Signed links are time-limited, and rotating `SESSION_SECRET` invalidates all
existing links. Re-run the tool to get a fresh link.

## `/admin` returns 404

`ADMIN_TOKEN` is unset, so the admin surface is intentionally absent. Set it and
restart. A 401 instead means the token does not match.

## Files disappear sooner than expected

`FILE_RETENTION_MINUTES` (default 120) governs deletion. On Render, a service
restart or a redeploy also clears anything not on a mounted persistent disk —
confirm `STORAGE_DIR` points at the disk mount (`/var/data`).

## The welcome animation replays every visit

It is suppressed via `localStorage`. Private browsing, or a browser that clears
site data, will replay it. With `prefers-reduced-motion` enabled the animation
is skipped entirely by design.

## Health check is "degraded" but the site works

Expected when an optional provider is unconfigured. `GET /api/health` shows
which subsystem is degraded. The service stays `healthy` overall as long as
storage and the database are fine.
