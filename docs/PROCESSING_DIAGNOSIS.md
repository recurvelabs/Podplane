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
