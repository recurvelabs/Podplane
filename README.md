# Podplane

A multi-user podcast service hosted at https://podplane-staging.challoner.dev. Visitors sign in with an email code or a previously enrolled passkey, choose podcasts from a shared catalog or add RSS feeds, and receive private combined or per-show feeds with detected ads removed.

The staging deployment has its own D1, R2 bucket, Workflows and secrets. The old Sites URL redirects to this staging host. See `processor/deployment-staging.json` for non-secret resource identifiers.

For a Codex handoff, read `CODEX_HANDOFF.md` and run `npm run setup:codex` with Node.js 24 or later. Project instructions are in `AGENTS.md`.

Source repository: https://github.com/recurvelabs/Podplane. The improvements informed by MinusPod and the next priorities are documented in `docs/MINUSPOD_FINDINGS.md`.

## Components

- `worker/index.js`: website, native login, catalog and account pages. In the legacy Sites deployment it redirects to staging. The staging entrypoint supplies verified session identity directly; request identity headers are ignored.
- `processor/staging.js`: combined Cloudflare staging entrypoint. Serves the website, authenticates API requests and serves private RSS/audio on the same origin.
- `processor/auth.js`: direct email-code delivery and verification, hashed sessions and SimpleWebAuthn passkeys.
- `processor/catalog.js`: shared public catalog, trusted directory lookup records and catalog seeding.
- `processor/index.js`: Cloudflare Worker API and `EpisodeWorkflow`, with D1, R2, Workers AI, and a 30-minute cron.
- `processor/media.js`: bounded MP3 frame indexing, lossless frame splicing, and byte-range parsing.
- `processor/detection.js`: separate advertisement detection and candidate review calls, constrained by transcript IDs and quoted evidence.
- `processor/feeds.js`: validated RSS ingestion and escaped RSS generation.
- `processor/schema.sql`: initial D1 schema. Apply once, then use additive migrations.
- `processor/deployment.json`: live resource identifiers and binding configuration, without secrets.

Podplane sends six-digit sign-in codes directly through a Cloudflare Email Service `EMAIL` binding, using a verified sender on `notify.podplane-staging.challoner.dev`. Codes expire after ten minutes, allow five guesses, and are consumed atomically. Only hashes are stored; verification also requires the random HttpOnly browser cookie. Send requests are limited per address and IP and require the same origin. Podplane issues a random, hashed, revocable HttpOnly/Secure session cookie after verification. The rest of the site remains accessible for passkey login and token-based RSS clients. Passkeys are bound to the exact staging origin and RP ID, require user verification, use single-use challenges and verify signatures with SimpleWebAuthn. Enrollment and deletion require a recent session. Private feed capabilities remain HMAC-signed, account scoped and revocable.

The catalog includes the current imported Apple Podcasts US top 200, with chart ranks, search, and existing curated public shows. The source snapshot and chart date are in `processor/data/us-top-podcasts.json`. `scripts/catalog-import.mjs` prepares a metadata-only D1 batch from that snapshot; the authenticated `/admin/catalog/import` endpoint applies the same import. Importing and browsing never create subscriptions, episodes or processing jobs. The scheduler and job dispatcher select only shows with an active user subscription. The catalog also includes feeds independently returned by the public podcast directory. Arbitrary pasted RSS feeds are excluded. Selecting a cached show creates a subscription without downloading or processing the episode again. Episodes and edited audio are shared by canonical feed URL; each account has its own private access links. The catalog's cache counts reflect completed episodes that are still within retention.

Unlimited access is a stored account entitlement (`accounts.unlimited=1`) granted by an operator. It removes the show cap, daily processing allowance, add/refresh/retry allowances, and beta episode duration/size caps for that account. Processing checks actual subscriptions and stored account flags; request bodies and identity headers cannot grant access. Shared episodes requested by an unlimited subscriber do not consume the beta processing allowance. Authentication, request protection, retention, format support and platform limits still apply.

## Managing your feed

Use **Remove from feed** beside a show in **My podcasts**, or on its card in the shared catalog. Confirm the named show to remove its subscription and episodes from your Podplane feeds. Your combined feed link stays the same; your podcast app picks up the change when it refreshes. Downloads already stored in the player remain under the player’s control. You can add the show again, reusing available cached episodes. Removal affects only your account.

## Reporting a missed ad

Open a ready episode in **My podcasts** and choose **Report a missed ad**. You can enter the playback time from your podcast player. Reports for the same published version share one investigation. The existing 30-minute job dispatches reviews, and the episode shows the outcome.

A review transcribes the published MP3 the listener heard, checks the whole episode and takes a closer look around a supplied time. Verified ads go through the same independent review and editorial boundary checks as new episodes. A successful repair updates the shared enclosure and compares the ad wording with the earlier audit. Refresh the feed and download the episode again to replace a local copy.

Inconclusive reviews preserve the existing audio. A listener can add a playback time to an inconclusive report initially filed without one. The job retries processing failures once. Operators can inspect the status, diagnostic detail, last failure, input version and result version in `missed_ad_reports`. The private repair audit records the transcript, reviewed cuts and the playback timeline used for the investigation.

## Audio pipeline

Combined RSS feeds prefix episode titles with a short show name, such as `Daily: ...`, `JRE: ...` or `PSA: ...`. Per-show feeds retain the publisher's episode titles. Feed URLs, episode GUIDs and audio enclosures stay the same.

New subscriptions enqueue the latest episode. Cron checks active shows every 30 minutes and picks up new episodes. Publisher downloads follow up to twenty redirects with destination validation and cycle detection. A resumable Workflow streams source audio into R2, indexes MP3 frames in bounded reads, transcribes three-minute chunks with Whisper Large V3 Turbo, and detects paid advertisements with Llama 3.3 70B. Uncovered transcript intervals of at least six seconds are transcribed again as short, frame-aligned clips. Kimi K2.7 reviews proposed cuts against the surrounding transcript. Both stages must report at least 90% confidence; removal requires the reviewer to cite an observed evidence segment inside the selected range, which the application quotes verbatim. The reviewer can reject or narrow a proposal. Transcript IDs constrain boundaries to observed segments. Overlapping context is used during classification. Episodes with more than 40% marked for removal are held.

Detection and review requests include JSON response schemas. Complete candidate spans from overlapping windows are merged before review. Each merged proposal receives a focused review and one retry for an incomplete verdict. The reviewer selects an evidence segment ID inside the final selected range; the audit record quotes that segment directly. Legacy quoted evidence must still match the final range exactly. An exact numbered transcript prefix may be stripped before validation; invented prose, out-of-range evidence and expanded boundaries are rejected. Commercial offers for the publisher's paid subscriptions, standalone promotional trailers and complete sponsor reads are included.

A focused opening pass checks consecutive commercials and anecdotal setups. After candidate review, Kimi K2.7 audits every retained transcript segment in overlapping windows with original segment IDs and surrounding ad context. It can propose missed ads, incomplete setups, closing taglines and other residual commercial speech. Every proposed repair receives a separate review. A successful repair triggers another full audit, up to three passes. Unusable initial reviews remain pending until resolved. Publication requires a pass that adds no further cuts and has no unresolved reviews; otherwise the Workflow fails while preserving any previously published version.

Each published version has a private `clean/<episode>/<publication-time>.audit.json` record containing its exact transcript, verified cuts, gap-recovery counts and full-audit coverage. It shares the audio's retention and deletion rules. No episode-specific cut overrides are used.

The edited file consists of retained MP3 frames, with obsolete ID3 and Xing metadata removed. Frames crossing a cut boundary and gaps between cuts are preserved. It is streamed into R2 with a fixed length. New audio versions use `clean/<episode>/<publication-time>.mp3`, and RSS/dashboard audio URLs include `?v=<publication-time>`. Existing legacy objects remain readable. Each version serves ranges using its own stored byte length. A reprocessing Workflow can keep the previous version available while its replacement is built; publication switches the database pointer after the new object is stored. RSS enclosures contain the edited duration and byte length. Successful processing deletes working indexes; exact publisher downloads remain private for the existing seven-day lifecycle so model reprocessing can reuse the same audio. Transcripts are cached for 30 days using the SHA-256 of each exact audio chunk, a versioned model/options namespace and relative timestamps. Retries and reprocessing reuse unchanged chunks; changed publisher audio is transcribed again. Detection and candidate review still run on each reprocess. Operators can set `retranscribe:true` in a Workflow payload to bypass this cache. Lifecycle rules delete temporary files after seven days and edited audio and transcript cache objects after 31 days; feed and API access expire at 30 days. Scheduled expiration removes every version of an expired episode, with paginated R2 listings.

Ad detection is approximate. Segment timestamps can be imprecise; the frame splice can cause a brief artifact at a cut because MP3 uses a bit reservoir. The model's confidence score is an instruction-following signal, not a calibrated probability. A larger listening evaluation is needed before describing this as production-grade ad removal.

## Current beta limits

- Five subscriptions per account; public HTTPS RSS feeds with MP3 enclosures.
- Latest episode on first import, followed by new releases. A maximum of three newly discovered episodes per show per refresh protects against back-catalog floods.
- Episode cap: three hours and 220 MiB; downloads must have a known Content-Length.
- 600 audio minutes reserved globally per UTC day. Retried failed jobs reuse the reservation, so retries can incur additional inference within this cap.
- Two concurrent processing Workflows. Three manual attempts per episode.
- Thirty-day audio archive. Free beta; billing and paid plans are not implemented.
- Email sign-in uses single-use codes delivered by Cloudflare Email Service. Passkey enrollment and sign-in are implemented with `@simplewebauthn/server` and `@simplewebauthn/browser`.

## Development and verification

Run `npm test`, `npm run build`, and `npm run validate` from this checkout. Install processor dependencies with `npm ci --prefix processor`. Build the staging Worker with `node scripts/build-staging.mjs`; this also bundles the browser passkey module. Tests cover real signed WebAuthn assertions, enrollment attestation, wrong-origin rejection, challenge replay, email delivery failures, code expiry and guess limits, concurrent code consumption, session expiry, catalog privacy and cache reuse.

The local preview server is strictly a development helper. It uses an empty sample library at `/app` and never supplies production credentials. It is excluded from the deployed bundle.

## Deployment

The Sites manifest owns the legacy redirect publication and source repository. The staging service is deployed directly to the user's Cloudflare account, using the combined `processor/dist/staging.js` module. Apply the base schema and the numbered files in `processor/migrations/` to a new staging database. Later schema changes require additive migrations.

The staging Worker binds D1 `DB`, R2 `AUDIO`, Workers AI `AI`, Workflow `PROCESS`, and Email Service `EMAIL`. Set `PUBLIC_ORIGIN` and `EMAIL_FROM` from the staging manifest. Restrict the email binding to that sender address. Preserve `INTERNAL_SECRET` and `FEED_SECRET` as runtime secrets across uploads. The staging host has no Cloudflare Access application; session checks protect account APIs and HMAC capabilities protect feeds.

Deploy the bundled `processor/dist/index.js` as a Worker ES module with the D1 `DB`, R2 `AUDIO`, Workers AI `AI`, and Workflow `PROCESS` bindings. Preserve `INTERNAL_SECRET` and `FEED_SECRET` on subsequent uploads. Never commit their values. The Workflow is `podplane-episodes`, exported class `EpisodeWorkflow`, concurrency two. The Worker cron is `*/30 * * * *`.

Use the Cloudflare connector's API upload or the Cloudflare CLI for deployment. Existing public feed links depend on `FEED_SECRET`; replacing it invalidates all links. Account deletion invalidates the account's links and removes its subscriptions. Shared cached episodes remain until retention expires.

Mixed ad/editorial boundary segments receive a separate Kimi check. Flagged segments are retranscribed with word timestamps, then the model independently reviews their cuts and audits the retained transcript again. Publication is held if editorial speech still occurs inside a cut boundary. No episode-specific timestamps or sponsor exceptions are used. Word-level transcriptions have a separate exact-audio cache namespace. Word fragments retain their original segment group for boundary checks; reviewers receive continuous spoken text as well as numbered segments so complete editorial transitions remain recognizable.

Dedicated promotional breaks for a publisher’s own newsletters, apps or memberships are included even when free. Boundary checks classify complete original phrases, then intersect the model’s quoted editorial words with the proposed cut. A conflicting cut is narrowed at observed word timestamps, independently reviewed, and followed by another full-transcript audit. Unresolved disagreement holds publication after three rounds.
