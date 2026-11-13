# Short design: light use of OpenNeuro ds003478

## Why
The question was whether OpenNeuro ds003478 could give the voice companion more context about patients' behaviour and which treatments help them.

The dataset is resting EEG plus BDI/STAI (and SCID/HAM-D for 32 people) from 122 students at one visit. It has no TMS, treatment, follow-up, or phone/wearable data, and our app has no EEG, so it can't feed the runtime loop. **Decision: light use.** Keep the voice-companion design unchanged, use the real scores to make the seeded patients realistic, and use the data for one evidence slide. Details are in `docs/research/ds003478/SOURCE.md`.

## Approaches
- **Light use (chosen):** seed scores plus one pitch stat. About 1–2 h, no change to the data contract.
- EEG headband in the home loop: rejected. It needs new hardware and about a day, and the frontal-alpha marker replicates poorly.
- Clinic-side EEG intake summary: rejected. It's story with no function.
- Closer-fit data: deferred. GLOBEM, StudentLife, DAIC-WOZ and RAVDESS/CREMA-D remain the threshold-tuning candidates in the main spec.

## Design
1. `docs/research/ds003478/data/participants.tsv` is vendored, with `SOURCE.md` covering the DOI, license, paper and caveats.
2. `docs/research/ds003478/stats.mjs` writes `findings.md`. Results (121 analysed):
   - **BDI–STAI r = 0.90** (n = 121): depression and anxiety scores move almost together.
   - **BDI–HAM-D r = −0.08** (n = 32, all from the high-BDI group, so the range is restricted): among people who all screen high on self-report, the self-report score says almost nothing about clinician-rated severity.
3. **Pitch claim (decided by the result):** "Self-report alone isn't enough. In open research data (OpenNeuro ds003478, n = 32 clinically interviewed), self-rated depression barely tracked clinician-rated severity (r ≈ −0.1). That's why the companion pairs the daily check-in with watch, phone and voice signals, and why the clinician sees all of them." Always add the caveats (student sample, range-restricted). Say "open research data", never "validated". Optional second line: anxiety and depression co-move (r = 0.90), so the check-in listens for both.
4. **Seed realism (plan Task 18).** Each synthetic patient carries one real row's scores in `intakeSummary`, framed as *discharge scores* and labelled with the source. Names stay fictional. No schema change.

   | Patient | Profile | Row | BDI · HAM-D · STAI | SCID |
   |---|---|---|---|---|
   | Laura | crisis | sub-081 | 29 · 21 · 60 | Current MDD |
   | Juhani | improving | sub-099 | 20 · 6 · 52 | Past MDD |
   | Aino | stable | sub-001 | 0 · n/a · 23 | not interviewed (low BDI) |

## Non-goals / anti-goals
- No EEG processing or EEG download.
- No claim that the sample represents TMS patients, and no thresholds derived from it.
- No real rows presented as real named people.
