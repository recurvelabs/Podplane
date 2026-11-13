# Podplane handoff

## Open and set up

Clone https://github.com/recurvelabs/Podplane, open the folder in Codex, and start with this prompt. The earlier `podplane-codex.zip` is also a usable baseline.

> Continue developing Podplane. Read AGENTS.md, README.md and CODEX_HANDOFF.md. Run npm run setup:codex. Review docs/PROCESSING_DIAGNOSIS.md, check the current state of the recovery jobs, and continue with any remaining processing failures. Preserve the existing live resources, account entitlements and feed signing secrets.

Use Node.js 24 or later. `npm run setup:codex` installs the processor dependencies, builds the staging Worker and browser passkey module, runs the test suite, and validates the legacy Sites build. The setup does not contact podcast publishers or process audio.

`npm run dev` opens a local UI preview on port 3000. Its library is a sample and its APIs are development stubs. Sign-in, live audio processing and production data need the deployed Cloudflare environment. Test fixtures use an in-memory SQLite database.

For Codex Cloud, select `recurvelabs/Podplane` in a Codex Cloud environment and use `npm run setup:codex` as the setup command. Reconnect Cloudflare there if deployment is needed.

## Live application

- Main application: https://podplane-staging.challoner.dev
- Shared catalog: https://podplane-staging.challoner.dev/catalog
- Earlier URL: https://podplane.dchalloner.chatgpt.site, which redirects to staging.
- Active Worker: `podplane-staging`.
- Active resource identifiers: `processor/deployment-staging.json`.
- Separate legacy audio service: `processor/deployment.json`.
- Existing Sites project identity: `.openai/hosting.json`.

The cloud resources continue running independently of this source handoff. This archive includes source, configuration identifiers, migrations and tests. It excludes live database rows, audio files, private feed URLs, login/session tokens, runtime secrets and local dependency directories.

## Completed behavior

- Email codes are sent through Cloudflare Email Service, with a sender restricted to `signin@notify.podplane-staging.challoner.dev`.
- Codes expire in ten minutes, allow five verification attempts, require the requesting browser, and can be used once. Passkeys support enrollment and sign-in.
- The catalog contains the Apple Podcasts US top 200 snapshot dated November 8, 2026, plus existing curated shows. Rank, text search and cached-audio filtering work.
- Catalog imports and browsing start no audio jobs. Following a show imports its latest episode; the scheduler checks followed shows every thirty minutes.
- Completed audio is cached once and reused across accounts. Accounts receive private combined and per-show RSS feeds. Combined feeds prefix episode titles with short show names; per-show titles, episode GUIDs and audio enclosures are preserved.
- The owner account has `accounts.unlimited=1` in the existing live database. The source has no email-based privilege shortcut. Existing email/passkey sessions read the entitlement from D1.
- Unlimited access removes show-count, add/refresh/retry and daily processing allowances, plus the beta episode size/duration caps. Standard users retain the usual limits.
- The validated suite has 59 passing tests, including WebAuthn signatures, email-code replay/expiry, catalog imports without processing, account isolation, unlimited entitlements, candidate review, cross-window ad breaks, incomplete-review recovery, audio versions, preservation of playback during a refresh and combined-feed title prefixes.

## Processing and costs

The workflow downloads publisher MP3 audio to R2 and indexes it in three-minute chunks. Whisper Large V3 Turbo returns timestamped transcript segments. Llama 3.3 70B identifies paid sponsor reads and returns transcript segment IDs. A separate candidate-review call can reject or narrow each proposed cut and must quote supporting text from the final range. Both calls need a confidence score of at least 0.90; episodes with more than 40% marked for removal are held. Retained MP3 frames are spliced and cached for thirty days. See `docs/MINUSPOD_FINDINGS.md` for the design and remaining evaluation work.

The candidate review and stricter MP3 boundary preservation were deployed to the active staging Worker on November 8, 2026 at 8:07 p.m. Pacific from GitHub source commit `9e8bdcc7e581295e00c6f4cc71c04260f6834531`. Cloudflare Worker version `87a278ed-bfca-4055-8f62-e3d1320ddc41` initially served all traffic. The deployment preserved the existing configuration and secrets. Browser checks confirmed healthy service output, a populated 202-show catalog and protected account APIs. Existing cached audio remains from the earlier pipeline; new jobs use the review step. The remaining active recovery job continued without an error after deployment.

A reviewer-response repair was deployed at 8:37 p.m. Pacific as Worker version `849ac45c-5259-412e-97c7-18a208785820`, which now serves all traffic. The previous review requested generic JSON; a live reproduction returned a garbled property name instead of `decisions`, causing the strict coverage check to fail the episode. Review requests now supply a JSON schema. Missing, conflicting or unusable verdicts preserve the affected audio and produce a library notice, while independently verified cuts can publish. Provider outages and invalid JSON still use normal Workflow retries. The affected Daily episode completed after resuming from its failed review, with five accepted cuts and no incomplete verdicts. See `docs/PROCESSING_DIAGNOSIS.md` for the recovery details.

Ad detection remains approximate. The confidence score is model-reported, timestamps can be imprecise, and frame splices can cause an audible artifact. A broader listening evaluation is still needed.

On November 9 at 8:42 a.m. Pacific, Worker version `c81dc267-a516-42c8-a8ae-42984f24b5b3` deployed complete cross-window candidate merging, focused reviews, detector response schemas and versioned audio publication. New jobs merge overlapping ad spans before review instead of clipping them at each window's core. An incomplete review gets one additional attempt. A `reprocess:true` Workflow payload preserves an existing ready episode while building the replacement; failed first-time episodes use normal processing. New audio objects and enclosure URLs carry a publication version, so older downloads remain separately addressable. The existing 19-episode subscription snapshot was queued again with The Daily prioritized. Existing podcast-app downloads need to be removed and downloaded again to pick up replacement audio.

The earlier single-pass planning estimate was roughly $0.04 per audio hour before free allowances and fixed hosting. It assumed $0.000513 per minute for Whisper, $0.293 per million Llama input tokens and $2.253 per million output tokens, using about 20,000 input and 1,000 output tokens per audio hour. Candidate review adds classification calls when proposals exist. Its incremental cost has not been measured. These figures are planning assumptions; recheck prices and measure both stages before making billing or product decisions.

## Known issues and unfinished verification

1. The initial publisher redirect failures were fixed on November 8, 2026. Publisher links needed six to eight redirects, while the old downloader made only six requests. `safeFetch` now allows twenty redirects, validates every destination and detects cycles. Live Pivot and Pod Save America retries passed downloads with six and eight redirects. See `docs/PROCESSING_DIAGNOSIS.md`.
2. The earlier Acquired failures on beta size/duration caps were resolved under the unlimited entitlement. All three long episodes had completed by November 9, before the current reprocessing pass. All nine earlier Pivot, Pod Save America and Ezra Klein retries also completed. Listening quality still needs evaluation.
3. Live email inbox delivery has not been exercised end to end. The sender DNS and binding were verified, and mocked delivery and verification tests pass. Use an explicitly authorized test recipient for a live delivery test.
4. Longer and larger MP3 processing has completed live runs and still needs a listening evaluation. The repair has regression coverage for redirect chains, loops, private destinations, and Workflow payloads supplied as either objects or JSON strings. Invalid Workflow payloads are rejected before D1 access.
5. Standard account first-import behavior and recurring refresh need further evaluation around back-catalog boundaries. The scheduler currently considers up to three recent candidates per refresh.

## Deployment and persistence

Build the active Worker with `npm run build:staging`. Its default export and `EpisodeWorkflow` class are in the resulting module. Deploy to the existing Worker with its existing D1, R2, AI, Workflow and email bindings. A content-only Worker upload preserves the current runtime configuration and secrets. Read the current account configuration before any deployment.

The existing staging database already has migrations 002 through 005 applied. Use additive migrations for future changes. New databases need `processor/schema.sql`, followed by every numbered migration in order. The unlimited grant is live data and is absent from a fresh database.

Cloudflare authorization and the two runtime secrets stay in their current services. Connect Codex to the user's Cloudflare account or use an appropriate local login before deploying. Preserve the current secrets; do not export or rotate them as part of this handoff.

Earlier source is versioned by the Sites source repository. The source baseline before these handoff files is `d4cc40ac1ea9dcf085cf145730006420cf114ec6`. GitHub receives a source snapshot for continued development; earlier Sites history remains in its original repository. Runtime credentials, audio, live database rows and generated dependencies are excluded.
