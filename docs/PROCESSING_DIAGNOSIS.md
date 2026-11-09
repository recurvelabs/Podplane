# Episode processing diagnosis

Investigated November 8, 2026, Los Angeles time.

## Initial failures

The staging database contained twelve failed episodes. Three Joe Rogan episodes had completed successfully, demonstrating that the transcription, classification and audio-editing pipeline could complete.

| Show | Failed episodes | Cause | Observed redirects to playable audio |
| --- | ---: | --- | ---: |
| Pivot | 3 | Downloader stopped before reaching the audio CDN | 6 |
| Pod Save America | 3 | Downloader stopped before reaching the audio CDN | 8 |
| The Ezra Klein Show | 3 | Downloader stopped before reaching the audio CDN | 7 |
| Acquired | 3 | Earlier beta caps: two duration failures and one size failure | 3 in the sampled enclosure |

The old `safeFetch` loop made at most six HTTP requests. A chain with six redirects needs a seventh request to receive the audio, so even Pivot hit the error. The chains were legitimate publisher measurement links leading to MP3 responses. Headers confirmed audio content and known lengths at the terminal URLs.

## Repair

- Allow up to twenty redirects, followed by the terminal request.
- Validate every redirected URL using the existing HTTPS/public-host rules.
- Detect repeated destination URLs and cancel intermediate response bodies.
- Store redirect counts and hostname-only traces in the Workflow download-step output.
- Accept both object and JSON-string Workflow payloads. The REST API's documented string payload arrived as a string at the Worker; the new validation normalizes it and rejects missing/invalid episode IDs before touching D1.

The initial bulk retry instances with the unexpected payload representation were terminated before audio work. Twelve fresh instances were then created with the corrected Worker. Episode attempts include those operator recovery attempts.

## Live validation

The new Pivot retry downloaded successfully through six redirects and reached transcription. The new Pod Save America retry downloaded successfully through eight redirects and reached indexing. At that verification point, two recovery instances were running and ten were queued by the existing concurrency limit of two. None of the recovery instances had a reported error.

The three Acquired failures were requeued under the owner's stored unlimited entitlement. Their complete long-file processing remains pending. Recovery is limited to previously selected shows; the catalog import and unselected shows were untouched.

## Automated verification

All 37 tests passed, along with staging compilation, legacy Sites compilation and artifact validation. Added cases exercise eight-hop chains, twenty-hop boundaries, cycles, private redirect destinations, JSON-string Workflow execution, and malformed payload rejection before D1 access.

The current result verifies the original download failure is repaired for live samples. Completion and listening quality for all twelve asynchronous recovery jobs still need a later check.

## Deployment follow-up

At the November 8, 2026 evening deployment check, all three Pivot, three Pod Save America and three Ezra Klein retries were ready. Two Acquired retries were also ready; one Acquired episode remained in transcription. The database had fifteen ready episodes and one transcribing episode, with no failed episode rows. The active older Workflow continued without an error after the new code upload. Listening quality still needs evaluation.

## Reviewer response failure

Later that evening, The Daily episode "Keisha Lance Bottoms on What Democrats Have to Do to Not Squander the Win" stopped at 89% with `Ad reviewer must decide every candidate`. Its Workflow was `ep-3281cb52a7468c85266eebf351763625b37e09f4-1`. The last review step, `review-300-0`, expected one verdict for transcript IDs 316-318 and failed on all three attempts. Earlier detection and review windows had completed.

The failed model response was not stored. Replaying the same excerpt with the original request reproduced a valid JSON object whose property name was garbled rather than `decisions`. Generic JSON mode constrained JSON syntax but supplied no response schema. The strict application check then turned an unusable verdict into a failure for the whole episode.

The repair adds a JSON response schema and matches decisions by candidate ID. A missing, duplicate, conflicting or unusable verdict keeps that candidate's audio intact. Other independently verified cuts may publish, with a notice that some possible ads were retained. Workflow results include `unreviewed`; structured logs contain counts and episode IDs without transcript text. Invalid JSON and provider outages still trigger normal step retries.

The same live excerpt returned a usable single decision under the new schema. All 54 automated tests passed, including the reproduced garbled-key case, partial decisions, duplicate conflicts, response order, preservation of unreviewed frames and provider failures. Worker version `849ac45c-5259-412e-97c7-18a208785820` was deployed at 8:37 p.m. Pacific on November 8, 2026 with configuration and secrets preserved. The affected Workflow was restarted from `review-300-0` to reuse its completed download and transcription.

The resumed Workflow completed successfully: five verified ad cuts, about 136 seconds marked for removal, and zero unreviewed candidates. Its final review, audio publication and cleanup each succeeded on the first attempt. No download or transcription was repeated during this recovery.

## Ads retained at detection-window boundaries

On November 9, The Daily's newest processed episode had six candidates but only three accepted cuts, totaling about 73 seconds. The logs showed a Schwab read split between IDs 148-149 in one window and 150-157 in the next. Both fragments stayed in the audio as incomplete reviews. Another candidate received a keep decision. The earlier repair improved availability by preserving unusable verdicts, which still left those ads audible.

The new detector keeps complete spans from overlapping context. Candidates from all windows are merged before a focused review of each commercial break. Detection and review both request response schemas. Incomplete review receives one additional attempt, with uncertain speech still preserved. Commercial paid-subscription offers from the publisher are explicitly covered. Regression tests reproduce the 148-157 boundary case end to end.

Reprocessing now preserves the previous published audio and writes a new versioned object before switching the current publication. RSS and dashboard URLs include that version; old version URLs keep their own byte lengths for seeking. The unchanged legacy objects remain readable. This prevents cache reuse across replacements, while copies already downloaded to a podcast app still require removal and another download.

All 58 tests, both builds and artifact validation passed. Worker version `c81dc267-a516-42c8-a8ae-42984f24b5b3` was deployed at 8:42 a.m. Pacific with the existing configuration and secrets. Nineteen current episodes across the existing six subscribed shows were queued for another pass, with The Daily prioritized. Reprocessing does not import or process unselected catalog shows.
