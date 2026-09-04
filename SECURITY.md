# Security

## Threat model

Royalway One is anonymous and unauthenticated by design. There are no accounts
to compromise and no payment data. The assets worth protecting are **the files
users upload**, **the provider API keys**, and **the availability of the
service**.

## Handling of user files

- Files are stored under `STORAGE_DIR`, outside the web root, named by a
  32-hex-character random id. Ids are unguessable and never sequential.
- Every file belongs to the anonymous session that uploaded it. Cross-session
  access is refused even with a correct id.
- Downloads use expiring links signed with `HMAC-SHA256(SESSION_SECRET, "<id>.<exp>")`.
  Tampering with the id or expiry invalidates the signature.
- A sweeper deletes files after `FILE_RETENTION_MINUTES` (default 120) and
  clears temp artefacts, including those left by failed jobs.
- File contents are never logged. Logs record ids, sizes and durations only.

## Upload safety

- Content type is determined by **sniffing magic bytes**, not by trusting the
  declared MIME type or the file extension.
- Only expected types are accepted per tool; executables are rejected (`415`).
- `MAX_UPLOAD_BYTES` (512 MB) and `MAX_MEDIA_SECONDS` (4 h) are enforced before
  processing begins, and media duration is checked with ffprobe before encoding.
- Uploaded names are sanitised; output names are generated server-side, so a
  crafted filename cannot traverse paths or poison a download header.

## Secrets

- Provider keys are read from the environment by the **server only**.
- They are never bundled into frontend code, never returned by any endpoint and
  never logged. `/api/capabilities` exposes booleans, not keys.
- In `render.yaml` they are `sync: false`, so they are entered in the Render
  dashboard and never committed to git.
- `SESSION_SECRET` and `ADMIN_TOKEN` use `generateValue: true`.
- `.env` files are gitignored.

## SSRF protection on media URLs

Transcribing a public URL is a deliberate outbound fetch, so it is constrained:
scheme must be `http`/`https`; the resolved address is checked against private,
loopback, link-local and metadata ranges (including `169.254.169.254`) and
rejected; redirects are re-validated at each hop; response size and time are
capped. `URL_INGEST_ENABLED=false` disables the feature entirely.

## Abuse controls

- Per-session rate limits on uploads, tool runs and AI calls, with a friendly
  `RATE_LIMITED` message rather than a bare 429.
- `MAX_CONCURRENT_JOBS_PER_SESSION` (default 3) prevents queue monopolisation.
- Long AI and transcription calls are aborted on a timeout so a hung provider
  cannot pin a worker.

## Web hardening

- Security headers via Helmet: HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP whose
  `frame-ancestors` defaults to `'self'` in production (`FRAME_ANCESTORS`).
- Downloads are served with `Content-Disposition: attachment` and a normalised
  content type, so an uploaded HTML file cannot execute in the app's origin.
- Session cookies are `httpOnly`, `sameSite=lax`, and `secure` in production.
- Request bodies are validated with zod at the route boundary.
- No CORS wildcard: the SPA is served from the same origin as the API.

## Admin surface

`/api/admin/*` returns **404 while `ADMIN_TOKEN` is unset** — the surface does
not exist unless explicitly enabled. When enabled, the `x-admin-token` header is
compared with `crypto.timingSafeEqual`. The dashboard exposes aggregate counts,
provider status and storage usage; it never lists file contents.

## Error handling

Users receive plain, actionable messages. Stack traces, provider payloads and
internal identifiers stay in server logs. Provider faults — 429, 5xx, malformed
bodies, empty completions, timeouts — are each mapped to a specific friendly
code. **An empty or unparseable provider response is treated as a failure, never
presented as a successful empty result.**

## Dependencies

Processing uses maintained native libraries (mupdf, sharp, FFmpeg, Tesseract)
rather than shelling out to arbitrary system binaries. Where an external binary
is used, arguments are passed as an argv array — never through a shell string —
so filenames cannot inject commands.

## Reporting a vulnerability

Contact Royalway Media directly rather than opening a public issue.
