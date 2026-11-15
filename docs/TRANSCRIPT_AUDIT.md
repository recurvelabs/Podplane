# PSA and Pivot full-transcript audit

Scope: the latest three available Pod Save America episodes and latest three Pivot episodes selected on November 14, 2026. All six were rebuilt by the deployed production pipeline. No episode-specific cut timestamps or manual cut overrides were applied.

## Production changes

- Kimi K2.7 independently reviews Llama 3.3 70B proposals, including consecutive sponsor reads, promotional trailers, commercial anecdotes, and closing taglines. Dedicated newsletter and app promotional interludes are included even when they belong to the publisher or advertise a free product.
- The pipeline retranscribes uncovered audio intervals of at least six seconds using short frame-aligned clips.
- A second model pass examines every retained transcript segment in overlapping windows. Every proposed repair receives independent review, followed by another full retained-transcript audit.
- Reviewers cite an evidence segment inside their final selected range. The application copies the observed text directly, avoiding repeated failures caused by generated quote formatting.
- A separate boundary check flags editorial speech inside proposed cuts. Those segments receive word timestamps and a fresh model review, followed by another full transcript audit and boundary check. Word fragments are grouped into coherent phrases so an editorial return remains recognizable. If review indices contradict that finding, the boundary model’s exact editorial quote is mapped to observed word timestamps, the cut is narrowed, and a separate review and full transcript audit run again. This loop is bounded and holds publication on unresolved disagreement.
- Publication requires convergence with no unresolved reviews. Failed refreshes preserve the previous audio. Source audio remains private for seven days to support repeatable reprocessing; transcript and edited-audio retention remain unchanged.

## Verified results

Durations below describe each final publisher download. Publishers dynamically insert advertisements, so a later download can differ from an earlier one. Cut blocks may contain several consecutive advertisements and should not be interpreted as a count of individual sponsors.

| Show | Episode | Cut blocks | Audio removed | Final duration | Transcript segments | Boundary segments refined |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Pivot | Jensen Huang Is Out: Nvidia’s Spy Scandal Rocks Silicon Valley | 12 | 9:24 | 61:09 | 1071 | 0 |
| Pivot | Nvidia CEO's Spy Scandal, JD Vance’s 2028 Problem, and America’s Brain Drain | 13 | 11:54 | 70:49 | 1362 | 2 |
| Pivot | Stephen Miller’s Promotion, Big Tech’s Reality Check, and Guest Harvey Levin | 14 | 11:07 | 64:52 | 1302 | 1 |
| PSA | Will Dems Chuck Chuck? | 13 | 14:37 | 62:31 | 1218 | 1 |
| PSA | Lessons From 2026 (Live From Crooked Con) | 4 | 6:25 | 91:00 | 1291 | 1 |
| PSA | From Anti-Trump to Pro-Something (Live from Crooked Con) | 5 | 7:25 | 95:59 | 1203 | 1 |

All six final records report converged full-transcript audits, zero unresolved reviews, and ready audio with no episode error. Published MP3 objects were independently checked for byte length, valid frame structure, and duration agreement with the database.

## Per-episode provenance

### Jensen Huang Is Out: Nvidia’s Spy Scandal Rocks Silicon Valley

- Episode: `8a9cf7624a31b0f17f6838c2721808ee1004f563`
- Workflow: `full-audit-v7-20261114-8a9cf762`
- Audit version: `full-transcript-v3-boundaries`
- Published replacement: 2026-11-14 23:25 UTC
- Private audit object: `clean/8a9cf7624a31b0f17f6838c2721808ee1004f563/1794698725.audit.json`
- Initial full-audit passes: 9 windows / 32 additional segments removed, 9 windows / 5 additional segments removed, 9 windows / 0 additional segments removed.
- Gap recovery: 5 intervals checked, 14 transcript segments recovered.

| Original audio start | Original audio end | Advertiser or promotion |
| ---: | ---: | --- |
| 0:01 | 0:30 | How I Built This / NPR |
| 0:33 | 0:56 | First Citizens |
| 1:00 | 1:28 | Bird's Eye View / Sue Bird |
| 32:53 | 34:02 | Quince |
| 34:05 | 34:59 | Pivot |
| 34:59 | 35:29 | Unexplainable / Netflix |
| 49:28 | 50:05 | Why Are You Like This? |
| 50:09 | 50:49 | Vox |
| 50:51 | 51:57 | Glean |
| 61:43 | 62:55 | Plaud |
| 62:58 | 63:56 | Base44 |
| 64:00 | 64:57 | Tanium |

### Nvidia CEO's Spy Scandal, JD Vance’s 2028 Problem, and America’s Brain Drain

- Episode: `d1915f0e6c2bad27cbd5e4aa1e678d0387634ab6`
- Workflow: `full-audit-v10-20261114-d1915f0e`
- Audit version: `full-transcript-v6-boundary-repair`
- Published replacement: 2026-11-14 23:52 UTC
- Private audit object: `clean/d1915f0e6c2bad27cbd5e4aa1e678d0387634ab6/1794700329.audit.json`
- Initial full-audit passes: 11 windows / 36 additional segments removed, 11 windows / 1 additional segment removed, 11 windows / 0 additional segments removed.
- Audit after boundary refinement: 12 windows / 0 additional segments removed, 12 windows / 0 additional segments removed.
- Gap recovery: 12 intervals checked, 17 transcript segments recovered.

| Original audio start | Original audio end | Advertiser or promotion |
| ---: | ---: | --- |
| 0:01 | 0:37 | Beehive |
| 0:40 | 1:09 | How I Built This |
| 1:12 | 1:41 | CoreWeave |
| 2:30 | 2:52 | Beehive |
| 29:56 | 31:07 | Beehive |
| 31:09 | 31:39 | Unexplainable / Netflix |
| 31:43 | 32:39 | Framer |
| 54:20 | 55:30 | Quince |
| 55:32 | 56:26 | Pivot Newsletter / pivotshow.com |
| 56:27 | 57:32 | Vox Explain / Vox Media |
| 69:17 | 70:11 | Indeed |
| 70:18 | 72:34 | Vanta, Beehive |
| 81:37 | 82:40 | Beehive |

### Stephen Miller’s Promotion, Big Tech’s Reality Check, and Guest Harvey Levin

- Episode: `5f00bf9a0684435479ad6056f3238457dbd33e56`
- Workflow: `full-audit-v11-20261114-5f00bf9a`
- Audit version: `full-transcript-v7-full-boundary-context`
- Published replacement: 2026-11-14 23:59 UTC
- Private audit object: `clean/5f00bf9a0684435479ad6056f3238457dbd33e56/1794700768.audit.json`
- Initial full-audit passes: 11 windows / 34 additional segments removed, 11 windows / 8 additional segments removed, 11 windows / 0 additional segments removed.
- Audit after boundary refinement: 11 windows / 1 additional segment removed, 11 windows / 0 additional segments removed, 11 windows / 0 additional segments removed.
- Gap recovery: 8 intervals checked, 9 transcript segments recovered.

| Original audio start | Original audio end | Advertiser or promotion |
| ---: | ---: | --- |
| 0:01 | 0:37 | Beehive |
| 0:39 | 1:09 | DeepGram |
| 1:10 | 1:38 | Harvey AI |
| 2:08 | 2:32 | Beehive / Tanium / Odoo |
| 28:19 | 29:31 | Beehive |
| 29:34 | 31:16 | Quince, Unexplainable / Netflix |
| 52:31 | 53:42 | Delete Me |
| 53:49 | 54:45 | Tanium |
| 54:48 | 55:42 | Pivot Post / Pivot Show |
| 69:51 | 70:32 | Vox |
| 70:34 | 71:11 | Why Are You Like This? podcast |
| 71:14 | 72:25 | Beehive |
| 74:24 | 74:31 | Beehive |
| 75:20 | 75:57 | Beehive |

### Will Dems Chuck Chuck?

- Episode: `fa22872b8b4fc774ff283065f0d62dec3881629b`
- Workflow: `full-audit-v7-20261114-fa22872b`
- Audit version: `full-transcript-v3-boundaries`
- Published replacement: 2026-11-14 23:14 UTC
- Private audit object: `clean/fa22872b8b4fc774ff283065f0d62dec3881629b/1794698093.audit.json`
- Initial full-audit passes: 10 windows / 57 additional segments removed, 10 windows / 0 additional segments removed.
- Audit after boundary refinement: 10 windows / 0 additional segments removed.
- Gap recovery: 7 intervals checked, 22 transcript segments recovered.

| Original audio start | Original audio end | Advertiser or promotion |
| ---: | ---: | --- |
| 0:00 | 1:04 | SimpliSafe |
| 1:05 | 2:04 | Beyond the Script |
| 2:05 | 3:06 | Remy Martin |
| 18:49 | 21:58 | Z-Biotics, Z-Biotics, Haya, Haya |
| 32:39 | 33:58 | Hungry Root |
| 33:59 | 34:58 | Beyond the Script / CVS, Beyond the Script |
| 34:59 | 36:00 | Beyond the Script, Remy Martin |
| 53:37 | 55:08 | Quince |
| 55:09 | 56:08 | Beyond the Script / iHeartRadio, Beyond the Script / CVS / iHeartRadio |
| 56:09 | 56:50 | Remy Martin |
| 75:08 | 76:08 | Remy Martin |
| 76:09 | 76:38 | Staples |
| 76:40 | 77:05 | Sprite |

### Lessons From 2026 (Live From Crooked Con)

- Episode: `d6484ee6319ee95bea25fce81577cc921fffd2ca`
- Workflow: `full-audit-v7-20261114-d6484ee6`
- Audit version: `full-transcript-v3-boundaries`
- Published replacement: 2026-11-14 23:14 UTC
- Private audit object: `clean/d6484ee6319ee95bea25fce81577cc921fffd2ca/1794698067.audit.json`
- Initial full-audit passes: 11 windows / 7 additional segments removed, 11 windows / 0 additional segments removed.
- Audit after boundary refinement: 11 windows / 0 additional segments removed.
- Gap recovery: 5 intervals checked, 8 transcript segments recovered.

| Original audio start | Original audio end | Advertiser or promotion |
| ---: | ---: | --- |
| 19:49 | 21:38 | Z-Biotics |
| 21:38 | 22:01 | Sierra Club |
| 45:43 | 48:48 | Noble, Trees.com |
| 63:44 | 64:53 | Squarespace |

### From Anti-Trump to Pro-Something (Live from Crooked Con)

- Episode: `1ec40243cdd2db46ba905ffc31df039f395f9966`
- Workflow: `full-audit-v7-20261114-1ec40243`
- Audit version: `full-transcript-v3-boundaries`
- Published replacement: 2026-11-14 23:29 UTC
- Private audit object: `clean/1ec40243cdd2db46ba905ffc31df039f395f9966/1794698962.audit.json`
- Initial full-audit passes: 10 windows / 0 additional segments removed.
- Audit after boundary refinement: 11 windows / 0 additional segments removed.
- Gap recovery: 6 intervals checked, 9 transcript segments recovered.

| Original audio start | Original audio end | Advertiser or promotion |
| ---: | ---: | --- |
| 0:00 | 1:27 | SimpliSafe |
| 20:02 | 21:11 | Squarespace |
| 21:11 | 22:15 | Bilt |
| 49:15 | 51:47 | ChiliPad, International Rescue Committee |
| 71:26 | 72:40 | Made In Cookware |

## Validation and deployment

- All 84 regression tests pass, including incomplete reviews, full-window coverage, missed sponsor fragments, transcript gap recovery, mixed ad/editorial boundaries, word timestamp caching, and preservation of previously published audio.
- `npm run build:staging`, `npm test`, `npm run build`, and `npm run validate` pass.
- Health endpoint: HTTP 200. Anonymous dashboard access: HTTP 401.
- Source implementation: `7abbc3091244d6724aa8df1bb810785979f7d2b6` on `main`.
- Worker version: `12afe745-26b6-4623-b59b-581302ac6be3`.
- Bundle SHA-256: `6816701fa2853208951dc8b68b762dce160126cdcb6936a5228b83c94ffa8daf`.
- Existing bindings, secrets, refresh schedule, two-job processing limit, and observation sampling were preserved.

These results establish the final model audit outcomes for the six downloaded audio versions. Ad detection and speech timestamps remain approximate. No exhaustive manual listening certification is claimed. Podcast players with an older local download need to refresh and download the replacement audio.
