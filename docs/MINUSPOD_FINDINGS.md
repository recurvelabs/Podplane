# Lessons from MinusPod

Reviewed November 8, 2026 (Pacific). Source: [ttlequals0/MinusPod](https://github.com/ttlequals0/MinusPod), commit `6f648a2d58cee1463d62ed0d81c9ecb224c9adc7` (November 8). MinusPod is MIT licensed. Podplane's changes are independently written JavaScript; no MinusPod code or prompts were copied.

## Changes included in this repository

| Lesson | Podplane implementation |
| --- | --- |
| Review the proposed cut before trusting it | A separate Llama call reviews every candidate. Both calls must score it at least 0.90. The review receives the surrounding transcript and proposed IDs without the detector's confidence or rationale. |
| Protect editorial speech and uncertain boundaries | The reviewer can keep a proposal or narrow it. Code rejects expansions, invented IDs, unsupported evidence and out-of-range scores. A removal must quote at least twelve characters from its final selected range. |
| Keep decisions must survive overlapping proposals | Overlapping detector proposals within a window are combined before review. Windows own disjoint core segment IDs. |
| Preserve evidence through merging | Accepted cuts retain detector/reviewer scores, quoted evidence and individual review records. Workflow results include candidate and review-rejection counts. |
| Avoid swallowing speech between cuts | Cut normalization preserves short gaps. The MP3 editor retains frames crossing a cut boundary, sacrificing at most an edge frame of removal to protect adjacent speech. |
| Treat failed review as unfinished processing | A malformed or unavailable review cannot publish unreviewed first-pass cuts. Review batches contain at most eight proposals and have separate resumable Workflow steps. Empty detection requires no review call. |

The implementation is in `processor/detection.js`, with integration in `processor/index.js`. It needs no new bindings, secrets, model providers or database migration. It preserves selected-show processing and shared caching.

## Further lessons and priorities

1. **A listening benchmark and corrections.** Build a small, manually labeled set spanning host-read ads, dynamically inserted ads, editorial brand discussion and transitions. Measure missed ads, clipped conversation, timing errors and processing cost. Store user corrections per show with a versioned audit trail before attempting automatic pattern reuse. Sponsor names alone should never become removal rules.
2. **Review UI and recuts.** MinusPod exposes confirm, reject and boundary adjustment controls. Podplane should retain source audio under an explicit retention policy, version edited files, then support authenticated corrections and recuts. Current accepted-cut metadata is a starting point; rejected proposals have counts in Workflow results but no durable human review queue.
3. **Measured usage.** MinusPod records individual inference calls and costs. Podplane needs per-stage token/audio usage and retry accounting so estimates can become measured per-episode costs. A reviewer adds classification calls only when proposals exist. Re-transcribing a whole edited episode would add another transcription pass.
4. **Run ownership.** MinusPod guards publishing and cancellation with a run identity. Podplane already claims job starts but should extend ownership checks to every progress, publication and failure update before introducing cancellation or overlapping operator retries.
5. **Audio corroboration.** Loudness changes, insertion splices, jingles and publisher-transcript differences can support candidates. Their absence does not prove speech is editorial. Podplane's current MP3 frame scanner does not decode waveforms; these features need a decoder or a separate audio-processing service.
6. **Feed portability.** OPML import/export and chapters with timestamps corrected after cuts would be useful additions. Imports must remain metadata-only until the user explicitly selects a show.

## What this review step establishes

MinusPod has both a candidate reviewer and a later verification pipeline that re-transcribes edited audio to find missed ads. Podplane implements candidate review in this change. A post-edit rescan, waveform analysis, learned patterns, manual review UI and new chapters remain future work.

Both Podplane passes currently use the same Llama model. Their errors can correlate, and model-reported confidence is uncalibrated. Exact evidence quoting checks transcript support; it cannot establish advertising semantics by itself. Segment IDs also cannot separate editorial and ad speech within a single transcription segment. Such proposals are instructed to stay intact. Frame boundaries protect nearby audio but do not eliminate MP3 bit-reservoir artifacts.

The automated suite checks safety gates and stream behavior with provider fixtures. Real listening evaluation and live model accuracy remain unmeasured. These source changes were deployed to `podplane-staging` on November 8, 2026 at 8:07 p.m. Pacific from commit `9e8bdcc7e581295e00c6f4cc71c04260f6834531`. Public service health, catalog rendering and account API protection were checked after deployment. Existing cached episodes have not been reprocessed with the new reviewer.

## Sources reviewed

- [Pipeline documentation](https://github.com/ttlequals0/MinusPod/blob/6f648a2d58cee1463d62ed0d81c9ecb224c9adc7/docs/how-it-works.md): detection windows, verification, holds, patterns, corrections and queue ownership.
- [Ad reviewer](https://github.com/ttlequals0/MinusPod/blob/6f648a2d58cee1463d62ed0d81c9ecb224c9adc7/src/ad_reviewer.py): confirmation, rejection, boundary adjustments, evidence and inconclusive outcomes.
- [Review stage](https://github.com/ttlequals0/MinusPod/blob/6f648a2d58cee1463d62ed0d81c9ecb224c9adc7/src/main_app/pipeline/review.py): review integration and protection of held or rejected spans.
- [Verification reconciliation](https://github.com/ttlequals0/MinusPod/blob/6f648a2d58cee1463d62ed0d81c9ecb224c9adc7/src/main_app/verification_reconciliation.py): keep barriers, standalone misses and confidence gating.
- [License](https://github.com/ttlequals0/MinusPod/blob/6f648a2d58cee1463d62ed0d81c9ecb224c9adc7/LICENSE).
