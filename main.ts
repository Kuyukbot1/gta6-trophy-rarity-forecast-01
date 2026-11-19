// gta6-trophy-rarity-forecast-01: forecast every Grand Theft Auto VI PS5
// trophy's Exophase earn rate at 2026-11-26T00:00:00Z, as five quantiles per
// trophy, from the house's reads of the trophy page up to the case
// checkpoint. Node 22, standard library only, deterministic.
//
// How the rates behave, and what the forecast does about it.
//
// Exophase does not refresh a game's counts continuously: it holds one set
// of numbers, then jumps to a new set hours later. On launch night the page
// sat unchanged for hours (638 players tracked, every rate fixed) and then
// jumped at 04:30Z to 3,868 players with every rate but the 100% one lower.
// So a case's history is a staircase: long flat runs, then a step. Two
// regimes follow:
//
// 1. Still on the first plateau (fewer than three distinct reads in the
//    history, as in both practice cases). No trend exists to fit, and the
//    next refresh is the whole story. The first refresh dilutes every rate
//    toward the broader player base: the published totals pin the average
//    dilution of the non-100% rates to 0.22 (the sum of the rates has to
//    match the new trophies-earned total once the trophy sitting at 100% is
//    set aside), so the median is the last rate times 0.22, with a wide
//    spread (0.65 logit units) because one refresh can land anywhere from
//    pure dilution (new players earning nothing yet, about 0.165) to the
//    totals-implied 0.22, and individual trophies scatter around the
//    average. The trophy at 100% stays at 100%: every tracked player holds
//    it, and a refresh cannot take it away.
//
// 2. Past the first refresh (three or more distinct reads). Each trophy's
//    logit rate grows roughly linearly in log(1 + hours since the release
//    day began): players accumulate and earn trophies at a steady pace on
//    that clock, so a least-squares line per trophy over the last 18 hours
//    of distinct reads, read at the target, is the centre. The spread
//    combines the fit's residual (how wobbly the trophy's own line is, with
//    a floor so a suspiciously straight line does not claim false
//    certainty) with a term that grows with how far ahead the target sits.
//
// Trophies whose own line cannot be fitted (too few distinct reads, or a
// flat line) borrow the median slope of trophies sitting near them in rate.
// Every forecast is capped so it can never run away: no median above 90%,
// and no more than 30x the trophy's last rate in logit terms.
//
// Deterministic: pure functions of the case file. No Date, no Math.random,
// no network. Reads are processed in file order, so two runs write the
// same bytes.
//
// Input: every <id>.in in MAKEFUN_INPUT_DIR (/input), one case per file.
// Output: <id>.out in MAKEFUN_OUTPUT_DIR (/output):
//   {"trophies":[{"id":1,"q":[q05,q25,q50,q75,q95]}, ...]}, one row per
//   trophy, each q finite, from 0 to 100, non-decreasing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const ZNORM = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];

/** Average dilution of the non-100% rates at the first refresh (see header). */
const PLATEAU_DILUTION = 0.22;
/** Logit spread while still on the first plateau (see header). */
const PLATEAU_SPREAD = 0.65;
/** How far back the trend fit looks, in hours before the last read: 18, so
    the line tracks the current trend regime — a 24h window drags in a stale
    pre-acceleration read and underestimates the weekend-acceleration cases
    (synthetic mean 0.167 vs 0.172 at 24h; practice proxies unchanged). */
const FIT_WINDOW_HOURS = 18;
/** Extra logit spread per unit of log-time between the last read and target. */
const SPREAD_PER_LOG_HOUR = 0.3;
/** Smallest residual a fit may claim, in logit units. */
const RESIDUAL_FLOOR = 0.15;
/** Smallest and largest logit spread a trend forecast may carry. */
const SPREAD_FLOOR = 0.35;
const SPREAD_CAP = 2.0;
/** No median above this rate (percent). */
const MAX_MEDIAN_RATE = 90;
/** No median more than this many times the trophy's last rate. */
const MAX_GROWTH = 30;
/** Logit spread for a trophy borrowing its neighbours' slope. */
const BORROW_SPREAD = 0.9;
/** Logit spread when a case has no history at all. */
const EMPTY_HISTORY_SPREAD = 1.5;
/** A trophy counts as a neighbour for slope borrowing within this logit gap. */
const NEIGHBOUR_GAP = 1.5;

interface TrophyInfo {
  id: number;
}

interface ReadRow {
  at: string;
  players_tracked?: number;
  trophies_earned?: number;
  rates: Array<number | null>;
}

interface CaseFile {
  id: string;
  target: string;
  levels: number[];
  game?: { release_date?: string };
  trophies: TrophyInfo[];
  history: ReadRow[];
}

/** A percent clamped into the range the scorer's logit is defined on. */
const clampPct = (x: number): number => Math.min(99.99, Math.max(0.01, x));
/** Logit of a rate in percent, after the scorer's clamp. */
const toLogOdds = (pct: number): number => {
  const p = clampPct(pct) / 100;
  return Math.log(p / (1 - p));
};
/** Inverse logit, back to a rate in percent. */
const fromLogOdds = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals (half up). */
const round4dp = (x: number): number => Math.round(x * 10000) / 10000;

/** Median of a non-empty list (sorted copy; average of the two middles when even). */
const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** Least-squares line of ys on xs: [intercept, slope]. */
const leastSquares = (xs: number[], ys: number[]): [number, number] => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let den = 0;
  let num = 0;
  for (let i = 0; i < n; i++) {
    den += (xs[i] - mx) * (xs[i] - mx);
    num += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = den === 0 ? 0 : num / den;
  return [my - slope * mx, slope];
};

/** log(1 + hours from the release-day start to a timestamp). */
const logHoursSince = (tMs: number, startMs: number): number =>
  Math.log(1 + Math.max(0, (tMs - startMs) / 3600000));

/** Five quantiles from a logit centre and spread, rounded and non-decreasing. */
const quantilesFrom = (centre: number, spread: number): number[] => {
  const out: number[] = [];
  for (const z of ZNORM) {
    const v = clampPct(round4dp(fromLogOdds(centre + z * spread)));
    out.push(out.length === 0 ? v : Math.max(v, out[out.length - 1]));
  }
  return out;
};

interface LineFit {
  intercept: number;
  slope: number;
  residual: number;
  points: number;
}

/**
 * One trophy's least-squares line of logit rate on log-hours, over the
 * distinct reads at or after `fromMs`. Null when the trophy has too few
 * points or no spread in time; a flat line (zero rate spread) keeps its
 * level with slope 0.
 */
const fitLine = (
  distinct: ReadRow[],
  trophy: number,
  fromMs: number,
  startMs: number,
): LineFit | null => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const read of distinct) {
    const tMs = Date.parse(read.at);
    if (tMs < fromMs) continue;
    const r = read.rates[trophy];
    if (r === null || r === undefined || !Number.isFinite(r)) continue;
    xs.push(logHoursSince(tMs, startMs));
    ys.push(toLogOdds(r));
  }
  if (xs.length < 3) return null;
  if (Math.max(...xs) - Math.min(...xs) <= 0) return null;
  if (Math.max(...ys) - Math.min(...ys) <= 0) {
    return { intercept: ys[0], slope: 0, residual: 0, points: xs.length };
  }
  const [intercept, slope] = leastSquares(xs, ys);
  let ss = 0;
  for (let j = 0; j < xs.length; j++) ss += (ys[j] - (intercept + slope * xs[j])) ** 2;
  const residual = xs.length > 2 ? Math.sqrt(ss / (xs.length - 2)) : 0;
  return { intercept, slope, residual, points: xs.length };
};

/** Forecast one case: one row per trophy, in the case's trophy order. */
const forecastCase = (c: CaseFile): Array<{ id: number; q: number[] }> => {
  const n = c.trophies.length;
  const targetMs = Date.parse(c.target);
  let startMs = NaN;
  if (c.game?.release_date) {
    const d = c.game.release_date;
    startMs = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
  }
  const history = (c.history ?? []).filter((h) => Number.isFinite(Date.parse(h.at)));
  if (!Number.isFinite(startMs) && history.length > 0) startMs = Date.parse(history[0].at);
  if (!Number.isFinite(startMs)) startMs = targetMs;
  if (history.length === 0) {
    return c.trophies.map((t) => ({ id: t.id, q: quantilesFrom(toLogOdds(1), EMPTY_HISTORY_SPREAD) }));
  }

  // Collapse the staircase: consecutive reads with identical rates carry no
  // new information, because Exophase holds its counts between refreshes.
  const distinct: ReadRow[] = [];
  for (const read of history) {
    const prev = distinct[distinct.length - 1];
    if (prev === undefined) {
      distinct.push(read);
      continue;
    }
    let same = true;
    for (let i = 0; i < n; i++) {
      if ((prev.rates[i] ?? null) !== (read.rates[i] ?? null)) {
        same = false;
        break;
      }
    }
    if (!same) distinct.push(read);
  }
  const last = distinct[distinct.length - 1];
  const lastMs = Date.parse(last.at);
  const xLast = logHoursSince(lastMs, startMs);
  const xTarget = logHoursSince(targetMs, startMs);
  const dx = Math.max(0, xTarget - xLast);

  // The last rate of each trophy, with a 1% stand-in where a read lacks it.
  const lastLogOdds = c.trophies.map((_, i) => {
    const r = last.rates[i];
    return toLogOdds(r === null || r === undefined || !Number.isFinite(r) ? 1 : r);
  });
  const lastRate = c.trophies.map((_, i) => {
    const r = last.rates[i];
    return r === null || r === undefined || !Number.isFinite(r) ? 1 : r;
  });

  // Regime 1: still on the first plateau. The next refresh dilutes every
  // rate toward the broader player base; the 100% trophy cannot move.
  if (distinct.length < 3) {
    return c.trophies.map((t, i) => {
      const centre =
        lastRate[i] >= 99.99 ? toLogOdds(99.99) : toLogOdds(lastRate[i] * PLATEAU_DILUTION);
      return { id: t.id, q: quantilesFrom(centre, PLATEAU_SPREAD) };
    });
  }

  // Regime 2: fit each trophy's line over the last day of distinct reads.
  const windowStartMs = lastMs - FIT_WINDOW_HOURS * 3600000;
  const fits = c.trophies.map((_, i) => fitLine(distinct, i, windowStartMs, startMs));
  const fitted = fits.filter((f): f is LineFit => f !== null);
  const pooledResidual = fitted.length > 0 ? medianOf(fitted.map((f) => f.residual)) : 0;

  return c.trophies.map((t, i) => {
    const fit = fits[i];
    const lLast = lastLogOdds[i];
    if (fit !== null) {
      const centre = Math.min(
        fit.intercept + fit.slope * xTarget,
        Math.max(lLast, toLogOdds(MAX_MEDIAN_RATE)),
        lLast + Math.log(MAX_GROWTH),
      );
      const clampedCentre = Math.max(centre, toLogOdds(0.01));
      const ownSpread = Math.max(fit.residual, RESIDUAL_FLOOR, 0.5 * pooledResidual);
      const spread = Math.min(
        SPREAD_CAP,
        Math.max(SPREAD_FLOOR, Math.sqrt(ownSpread * ownSpread + (SPREAD_PER_LOG_HOUR * dx) ** 2)),
      );
      return { id: t.id, q: quantilesFrom(clampedCentre, spread) };
    }
    // No line of its own: borrow the median slope of trophies sitting near
    // it in rate, but only when the trophy has actually moved before.
    const seen: number[] = [];
    for (const read of distinct) {
      const r = read.rates[i];
      if (r !== null && r !== undefined && Number.isFinite(r)) seen.push(r);
    }
    const moved = seen.length > 0 && Math.max(...seen) !== Math.min(...seen);
    const near = fitted.filter((_, j) => Math.abs(lastLogOdds[j] - lLast) <= NEIGHBOUR_GAP);
    const slope = moved && near.length > 0 ? medianOf(near.map((u) => u.slope)) : 0;
    const centre = Math.min(lLast + slope * dx, Math.max(lLast, toLogOdds(MAX_MEDIAN_RATE)));
    return { id: t.id, q: quantilesFrom(Math.max(centre, toLogOdds(0.01)), BORROW_SPREAD) };
  });
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith('.in'))
  .sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const trophies = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
