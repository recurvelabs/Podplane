# Opening-ad recovery - November 14, 2026

The latest Pod Save America episode, "Will Dems Chuck Chuck?", had three opening advertisements. Its original processing removed SimpliSafe at 0.00-63.92 seconds but retained the Switchboard promotion at 65.22-124.18 and the Coca-Cola read at 124.76-194.58. The show introduction begins at 216.08 seconds.

The detector proposed incomplete or mixed boundaries. The reviewer also cited neighboring sponsor text or invented evidence. Exact-quote validation correctly rejected those decisions, including on an identical retry. Four candidates across the episode remained unreviewed.

The fix gives longer episodes a focused opening pass, includes standalone promotional trailers and full commercial setups, and separates each candidate's text from two neighboring context segments on either side. Reviewer prompts have no fabricated example quote. Validation retries explicitly ask for a corrected exact quote. Existing confidence, index, evidence and removal-percentage safeguards remain in place.

A replay against the original saved opening transcript accepted all three opening ranges with no incomplete decisions, recovering approximately 129 additional seconds and preserving the show introduction. This is a live-model transcript regression, not an exhaustive accuracy measurement.

Validation: 71 tests, staging build, legacy build, artifact validation and diff checks pass. New regressions cover neighboring-sponsor evidence rejection, complete anecdotal ads, recovery of consecutive opening commercials, retry repair, preservation of the show introduction, and independently verified residual taglines while retaining editorial or unverified gaps.

Deployed to the existing podplane-staging Worker at 12:39 p.m. Pacific, version `18931937-109e-4269-bc76-aaeb19d1c9d1`, with 100% traffic. The content-only upload preserved bindings, secrets and observation sampling. Live health returned 200 and anonymous account access returned 401. Reprocessing instance `psa-opening-v4-20261114` rebuilds episode `fa22872b8b4fc774ff283065f0d62dec3881629b` while its old audio remains available. Publisher-inserted advertising may differ in the fresh download, so final cut times must be checked against that run's transcript.

The completed fresh download contained SimpliSafe, CVS and a jewelry advertisement at the start. Processing removed 641 seconds across nine ranges, with no incomplete reviews. Transcribing the resulting opening revealed a remaining one-second SimpliSafe tagline. The additional gap audit detected and independently reviewed that fragment, extending the first cut from 62.74 to 63.90 seconds. The audit is bounded to three gaps in the first five minutes, with no more than three segments or ten seconds per gap; it never automatically bridges a gap.

The gap audit is deployed in Worker version `2722e878-bb9e-4eca-b62c-00e6b0c6499f`. To apply its verified result to the completed episode without downloading a different publisher variant, the selected clean audio was trimmed by exactly 48 MP3 frames (1.152 seconds). The retained suffix is byte-for-byte unchanged. A new immutable audio version was uploaded before switching the database pointer with an expected-version check. Earlier audio versions remain available.

Final publication: `ready_at=1794689698`, 60,269,952 bytes, 3,766.872 seconds, approximately 642.4 seconds removed, status ready, no review warning. Independent transcription of the corrected opening starts with the hosts' show introduction at 24.12 seconds; the opening ad reads and tagline are absent. Refreshing RSS and redownloading replaces already downloaded audio.
