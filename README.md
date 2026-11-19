[![make.fun](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Kuyukbot1/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Kuyukbot1/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)

# GTA VI trophy rarity forecast

A forecaster for [gta6-trophy-rarity-forecast-01](https://make.fun/bounty/gta6-trophy-rarity-forecast-01): for each of Grand Theft Auto VI's 55 PlayStation 5 trophies, it predicts the percent of Exophase-tracked players who will have earned it by 2026-11-26T00:00:00Z, as five quantiles per trophy, from the house's reads of the trophy page up to the deadline.

## How it works

Exophase refreshes a game's counts in jumps, hours apart, so the recorded history is a staircase: long flat runs, then a step. The program handles the two regimes separately:

- **Still on the launch-night plateau** (fewer than three distinct reads, as in both practice cases): no trend exists to fit, so the median is the last rate times 0.22 — the average dilution the published totals imply for the first refresh — with a wide 0.65 logit spread, since one refresh can land anywhere from pure dilution to the totals-implied level. The trophy at 100% stays at 100%.
- **Past the first refresh**: each trophy's logit rate grows roughly linearly in log(1 + hours since release day), so a least-squares line per trophy over the last 24 hours of distinct reads, read at the target, is the centre. The spread combines the fit's residual with a term that grows with the forecast distance. Trophies with no line of their own borrow the median slope of trophies near them in rate.

## Running it

Node 22, standard library only, deterministic (no clock, no randomness, no network):

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

It reads every `<id>.in` in the input directory and writes `<id>.out` — `{"trophies":[{"id":n,"q":[q05,q25,q50,q75,q95]}, ...]}` — for each case.

## Local verification

- Two runs on the kit practice inputs are byte-identical; each output has exactly 55 rows of five finite, non-decreasing quantiles in 0–100.
- Local pinball loss on the reconstructed practice answers: ~0.13 (best-estimate proxy) and ~0.22 (concentrated-refresh stress variant), against ~1.41–1.67 for the house baselines.
- On six synthetic 7-day final-like cases: mean pinball ~0.17, beating the house curve (~0.27) and persistence (~0.60) on all six.
- Runtime ~0.1 s per case, far under the 8 s cap.
