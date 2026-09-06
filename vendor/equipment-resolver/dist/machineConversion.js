// Official CrossFit CAP Affiliate Programming "Machine Conversions" chart
// (assets.crossfit.com/affiliates/CAP_CardioConversionCharts_v.1.pdf,
// "METERS" page, 2022). Six reference rows keyed by Run distance, each
// carrying a female and male figure per machine -- NOT a clean fixed
// multiplier (e.g. Assault/Row ratio is 2.1875 at some rows, 2.5 at others),
// so this interpolates between the chart's own points rather than deriving
// one ratio and applying it everywhere. Row and Ski are one column in the
// source chart (treated as equivalent); Assault and Echo Bike are one
// column too (also treated as equivalent) -- that's the chart's own
// modeling choice, not a simplification made here.
//
// Presentation: CrossFit's own convention is to print both loads together
// ("95/65 lb"), not to ask the athlete their sex and show one number --
// John's call (2026-09-06) after an earlier draft of this feature proposed
// a sex field on profiles. Every function here returns {female, male}
// together for exactly that reason; there is no per-athlete sex anywhere
// in this codebase and this module doesn't need one.
// The chart's six reference points, ascending by run distance.
const CHART = [
    { run: 400, row_ski: { f: 400, m: 500 }, c2_bike: { f: 800, m: 1000 }, assault_echo_bike: { f: 875, m: 1250 } },
    { run: 800, row_ski: { f: 800, m: 1000 }, c2_bike: { f: 1600, m: 2000 }, assault_echo_bike: { f: 1750, m: 2500 } },
    { run: 1600, row_ski: { f: 1600, m: 2000 }, c2_bike: { f: 3200, m: 4000 }, assault_echo_bike: { f: 3150, m: 4500 } },
    { run: 5000, row_ski: { f: 4000, m: 5000 }, c2_bike: { f: 8000, m: 10000 }, assault_echo_bike: { f: 8750, m: 12500 } },
];
function valueFor(row, machine) {
    return machine === 'run' ? row.run : row[machine];
}
// Linear interpolation (extrapolating past the last point on the same
// slope) between whichever two chart rows bracket `fromDistance` on the
// `fromMachine` axis, then reading the paired value on `toMachine` at that
// same interpolation fraction. Both machines are converted through their
// own run-equivalent position in the table, which is how the source chart
// itself is structured (every column is indexed by the same six run
// distances) -- this is not an assumption layered on top of the chart, it's
// how the chart is already organized.
function interpolate(fromDistance, fromMachine, toMachine, sex) {
    const fromAt = (row) => {
        const v = valueFor(row, fromMachine);
        return typeof v === 'number' ? v : v[sex];
    };
    const toAt = (row) => {
        const v = valueFor(row, toMachine);
        return typeof v === 'number' ? v : v[sex];
    };
    // Bracket-finding has three cases, and each sex's axis needs this done
    // independently (this was the bug an early version had: male reference
    // distances start higher than female's on every machine, e.g. row_ski.m
    // starts at 500 vs. row_ski.f's 400, so a common prescription like
    // "400m row" falls BELOW the male axis's first point even though it's
    // exactly on the female axis's first point -- that needs the same
    // extrapolate-downward handling as going below both axes, not a
    // fallback that silently spans the entire table).
    let lo;
    let hi;
    if (fromDistance <= fromAt(CHART[0])) {
        lo = 0;
        hi = 1;
    }
    else if (fromDistance >= fromAt(CHART[CHART.length - 1])) {
        lo = CHART.length - 2;
        hi = CHART.length - 1;
    }
    else {
        lo = 0;
        hi = 1;
        for (let i = 0; i < CHART.length - 1; i++) {
            if (fromDistance >= fromAt(CHART[i]) && fromDistance <= fromAt(CHART[i + 1])) {
                lo = i;
                hi = i + 1;
                break;
            }
        }
    }
    const fromLo = fromAt(CHART[lo]);
    const fromHi = fromAt(CHART[hi]);
    const toLo = toAt(CHART[lo]);
    const toHi = toAt(CHART[hi]);
    const fraction = fromHi === fromLo ? 0 : (fromDistance - fromLo) / (fromHi - fromLo);
    return toLo + fraction * (toHi - toLo);
}
// Rounds to the nearest 5m under 1000m, nearest 10m at or above -- matches
// how the chart's own numbers are rounded (400, 800, 1600 vs. 875, 1750),
// and avoids presenting false precision like "487m" on a workout card.
function roundDistance(m) {
    const step = m < 1000 ? 5 : 10;
    return Math.round(m / step) * step;
}
/**
 * Converts a prescribed distance on one machine to its equivalent on
 * another, for both sexes, per the official CAP chart. Returns whole-meter
 * values pre-rounded for display (e.g. "500/400m Row" style pairs) -- pass
 * the result straight into a template, don't re-round it.
 */
export function convertDistance(distanceM, from, to) {
    if (from === to)
        return { female: roundDistance(distanceM), male: roundDistance(distanceM) };
    return {
        female: roundDistance(interpolate(distanceM, from, to, 'f')),
        male: roundDistance(interpolate(distanceM, from, to, 'm')),
    };
}
/**
 * Given a distance prescribed on a machine the athlete doesn't have, and
 * the set of cardio machines they DO have, returns a converted-equivalent
 * option per owned machine (skipping `from` itself and 'run' unless the
 * athlete's equipment tags include it -- most gyms without a given erg
 * still have floor space to run, so callers typically always include
 * 'run' in `ownedMachines` regardless of what's in profile_equipment).
 */
export function machineScaleOptions(distanceM, from, ownedMachines) {
    return ownedMachines
        .filter((m) => m !== from)
        .map((machine) => ({ machine, ...convertDistance(distanceM, from, machine) }));
}
export const CAP_MACHINE_LABEL = {
    run: 'Run',
    row_ski: 'Row/Ski',
    c2_bike: 'C2 Bike',
    assault_echo_bike: 'Assault/Echo Bike',
};

