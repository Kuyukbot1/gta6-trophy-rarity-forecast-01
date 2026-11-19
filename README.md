[![make.fun](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Kuyukbot1/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Kuyukbot1/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)

An entry for the [make.fun bounty](https://make.fun/bounty/gta6-trophy-rarity-forecast-01).

# GTA VI trophy rarity forecast — gta6-trophy-rarity-forecast-01

A program that forecasts, for every Grand Theft Auto VI PlayStation 5
trophy, its earn rate on Exophase at 2026-11-26T00:00:00Z — the percent of
the players Exophase tracks who will have earned it a week after launch —
from everything the house recorded of the trophy page up to the deadline,
as five quantiles a trophy.

## What it does

- `main.ts` (Node 22, standard library only, deterministic) reads one case
  JSON per run and writes `<id>.out` with one row per trophy (55 at the
  opening), each five quantiles `[q05, q25, q50, q75, q95]`. It runs
  offline, no network, in about 0.1 s per case.
- The model is fitted at run time from the case file's own history —
  nothing is fitted to the final case, which nobody can see:
  1. **Distinct reads.** Exophase refreshes a game's counts on its own
     schedule, hours apart, so the page is a step function: long flat
     plateaus, then jumps at refreshes. The model fits on one read per
     plateau, never on the raw 10-minute reads, which would overweight
     however long a plateau happened to last.
  2. **Per-trophy trend.** For each trophy, the least-squares slope of
     logit(rate) on ln(1 + hours since the release day began) over its
     distinct reads in the last 24 hours, applied forward from its rate
     in the last read. An early story trophy climbs fast; the platinum
     falls as the tracked population outgrows its handful of holders; a
     trophy whose rate never moved gets slope 0 — a trophy at 100%
     stays at 100%.
  3. **Caps.** Forecast odds may grow at most 30x from the last read,
     and no rate is forecast above 90% — but a cap never drags a trophy
     below its last read's level.
  4. **Spread.** sigma = sqrt(s² + (0.4·dx)²), s the trophy's residual
     spread, dx the log-time distance to the target: the further the
     extrapolation, the wider the band.
  5. **Flat history.** If no refresh has been seen yet, the forecast
     expects the one the target straddles: every rate falls to 22% of
     its last read, with a wide spread. That 22% is pinned by the
     totals the competition itself publishes for the first refresh
     (638 → 3,868 players tracked, 943 → 4,276 trophies earned, the
     one trophy at 100% staying there): new players had earned almost
     nothing beyond the trophy everyone holds.

## Why this shape

A trophy's earn rate is holders over tracked players, and both move:
players keep syncing (which dilutes every rate) while holders grow as
players progress (which raises them). The per-trophy log-time trend
reads the net of those two forces off the case's own recording instead
of assuming either one wins, and the refresh prior handles the one
shape the trend cannot see — a history that has not refreshed yet.

## Validation

The kit ships no reference answers, so the practice answers used here
are reconstructed from the totals the competition itself publishes
(see `BUILD_LOG.md` in the bounty folder), and the final is tested on
locally simulated 7-day recordings (three truth shapes: log-linear,
weekend bump, saturating). Mean pinball loss on the logit scale, mine
vs the house baselines:

| case | mine | curve baseline | persistence |
| --- | --- | --- | --- |
| practice p00/p01 (proxy) | 0.161 | 1.405 | 1.405 |
| synthetic log-linear | 0.091 | 0.216 | 0.641 |
| synthetic weekend bump | 0.108 | 0.240 | 0.754 |
| synthetic saturating | 0.325 | 0.343 | 0.412 |
| **synthetic mean** | **0.175** | **0.266** | **0.602** |

Two runs of one case write byte-identical output. Full numbers,
rejected alternatives and the determinism check are in `BUILD_LOG.md`
in the bounty folder (not part of the entry).

## Run it

```bash
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Two runs of one case write byte-identical output.
