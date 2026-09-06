// Official CrossFit CAP Affiliate Programming "Machine Conversions --
// Meters" and "Machine Conversions -- Calories" charts, lifted directly
// from John's own compiled reference (CrossFit_Exercises_By_Modality.md,
// "CARDIO CONVERSION REFERENCE" section, sourced from CrossFit Affiliate
// Programming 2022). Every value below is printed in that source, NOT
// derived -- interpolate() still does the math for a value that falls
// BETWEEN two of a chart's own rows, but the rows themselves are the
// chart's own numbers, not an estimate.
//
// Row and Ski are one column in the source chart (treated as equivalent)
// in both tables. Assault and Echo Bike are two separate columns in the
// METERS table with genuinely different figures -- NOT equivalent -- but
// this app's own equipment picker (app/settings) only offers one combined
// "Bike (Echo/Assault-style)" tag, so there's no way to know which specific
// machine an athlete has. The meters bucket uses the source's Echo Bike
// column specifically (John's call, 2026-09-06), with each row's pair
// sorted so the larger figure is always male -- the source document's own
// "Echo ♀/♂" column has inconsistent column order (row-to-row it sometimes
// prints the larger figure first, sometimes second, unlike every other
// machine's column, which is consistently male-larger -- almost certainly
// a transcription error upstream of this codebase), so this takes the two
// printed figures at face value and assigns the larger one to male rather
// than trusting which position each was printed in. In the CALORIES table,
// Assault and Echo are printed as identical figures at every row, so no
// such judgment call is needed there.
//
// Presentation: CrossFit's own convention is to print both loads together
// ("95/65 lb"), not to ask the athlete their sex and show one number --
// John's call (2026-09-06) after an earlier draft of this feature proposed
// a sex field on profiles. Every function here returns {female, male}
// together for exactly that reason; there is no per-athlete sex anywhere
// in this codebase and this module doesn't need one.
const METERS_CHART = [
    { run: 200, row_ski: { f: 200, m: 250 }, c2_bike: { f: 400, m: 500 }, assault_echo_bike: { f: 500, m: 700 } },
    { run: 400, row_ski: { f: 400, m: 500 }, c2_bike: { f: 800, m: 1000 }, assault_echo_bike: { f: 900, m: 1250 } },
    { run: 800, row_ski: { f: 800, m: 1000 }, c2_bike: { f: 1600, m: 2000 }, assault_echo_bike: { f: 1750, m: 2500 } },
    { run: 1600, row_ski: { f: 1600, m: 2000 }, c2_bike: { f: 3200, m: 4000 }, assault_echo_bike: { f: 3500, m: 5000 } },
    { run: 5000, row_ski: { f: 4000, m: 5000 }, c2_bike: { f: 8000, m: 10000 }, assault_echo_bike: { f: 11200, m: 16000 } },
    { run: 10000, row_ski: { f: 8000, m: 10000 }, c2_bike: { f: 16000, m: 20000 }, assault_echo_bike: { f: 21000, m: 31000 } },
];
// The calories table's own time-domain/run-distance reference points are a
// DIFFERENT set than the meters table's (it includes 600 and 1200, which
// meters doesn't) -- this is the source chart's own structure, not a typo,
// so it gets its own row set rather than reusing METERS_CHART's.
const CALORIE_CHART = [
    { run: 200, row_ski: { f: 12, m: 15 }, c2_bike: { f: 12, m: 15 }, assault_echo_bike: { f: 12, m: 15 } },
    { run: 400, row_ski: { f: 32, m: 40 }, c2_bike: { f: 32, m: 40 }, assault_echo_bike: { f: 24, m: 32 } },
    { run: 600, row_ski: { f: 40, m: 50 }, c2_bike: { f: 40, m: 50 }, assault_echo_bike: { f: 36, m: 45 } },
    { run: 800, row_ski: { f: 60, m: 75 }, c2_bike: { f: 60, m: 75 }, assault_echo_bike: { f: 48, m: 60 } },
    { run: 1200, row_ski: { f: 80, m: 100 }, c2_bike: { f: 80, m: 100 }, assault_echo_bike: { f: 75, m: 90 } },
    { run: 1600, row_ski: { f: 125, m: 150 }, c2_bike: { f: 125, m: 150 }, assault_echo_bike: { f: 90, m: 150 } },
    { run: 5000, row_ski: { f: 320, m: 400 }, c2_bike: { f: 320, m: 400 }, assault_echo_bike: { f: 240, m: 300 } },
    { run: 10000, row_ski: { f: 640, m: 800 }, c2_bike: { f: 640, m: 800 }, assault_echo_bike: { f: 480, m: 600 } },
];
function valueFor(row, machine) {
    return machine === 'run' ? row.run : row[machine];
}
// A prescribed distance like "500m Ski" (or a prescribed calorie count like
// "32 Cal Echo Bike") is ONE physical number, not two -- there's no such
// thing as "on the female axis" versus "on the male axis" independently.
// This app's own convention (matching the male-first "135/95" load
// convention used everywhere else) is that a single stored number is the
// MALE reference. So the interpolation fraction is computed exactly once,
// off the `from` machine's MALE axis of whichever chart is passed in, and
// that one fraction is then read against BOTH the `to` machine's female
// and male columns.
//
// An earlier version of this function computed the fraction TWICE -- once
// against the `from` machine's female axis, once against its male axis --
// as if a single input number meant something different depending which
// column you interpolated it against. That produced nonsense whenever
// `from` and `to` shared the same chart column (Row and Ski Erg are
// literally the same 'row_ski' bucket): converting "500m Ski" to "Row"
// came back "500/500" instead of "500/400" (John's report, 2026-09-06),
// because interpreting the same 500 independently against row_ski's own
// female axis (400-800 range) and male axis (exactly at the 500 reference
// point) gave two different, uncorrelated fractions instead of one
// coherent answer. Anchoring to the male axis alone and reusing that
// fraction for both output columns fixes this for every pair of machines,
// not just same-bucket ones -- there is no legitimate case where a single
// input number should be read as two different positions in the chart.
function fractionAt(chart, fromValue, fromMachine) {
    const maleAt = (row) => {
        const v = valueFor(row, fromMachine);
        return typeof v === 'number' ? v : v.m;
    };
    // Bracket-finding has three cases: below the first point, above the
    // last, or between two adjacent points -- extrapolating on the same
    // slope in the below/above cases rather than clamping, so a value
    // outside the chart's own range (e.g. a very short or very long
    // machine piece) still gets a real answer instead of a flat one.
    let lo;
    let hi;
    if (fromValue <= maleAt(chart[0])) {
        lo = 0;
        hi = 1;
    }
    else if (fromValue >= maleAt(chart[chart.length - 1])) {
        lo = chart.length - 2;
        hi = chart.length - 1;
    }
    else {
        lo = 0;
        hi = 1;
        for (let i = 0; i < chart.length - 1; i++) {
            if (fromValue >= maleAt(chart[i]) && fromValue <= maleAt(chart[i + 1])) {
                lo = i;
                hi = i + 1;
                break;
            }
        }
    }
    const maleLo = maleAt(chart[lo]);
    const maleHi = maleAt(chart[hi]);
    const fraction = maleHi === maleLo ? 0 : (fromValue - maleLo) / (maleHi - maleLo);
    return { lo, hi, fraction };
}
function interpolate(chart, fromValue, fromMachine, toMachine) {
    const { lo, hi, fraction } = fractionAt(chart, fromValue, fromMachine);
    const femaleAt = (row) => {
        const v = valueFor(row, toMachine);
        return typeof v === 'number' ? v : v.f;
    };
    const maleAt = (row) => {
        const v = valueFor(row, toMachine);
        return typeof v === 'number' ? v : v.m;
    };
    const femaleLo = femaleAt(chart[lo]);
    const femaleHi = femaleAt(chart[hi]);
    const maleLo = maleAt(chart[lo]);
    const maleHi = maleAt(chart[hi]);
    return {
        female: femaleLo + fraction * (femaleHi - femaleLo),
        male: maleLo + fraction * (maleHi - maleLo),
    };
}
// Rounds to the nearest 5m under 1000m, nearest 10m at or above -- matches
// how the chart's own numbers are rounded (400, 800, 1600 vs. 875, 1750),
// and avoids presenting false precision like "487m" on a workout card.
function roundDistance(m) {
    const step = m < 1000 ? 5 : 10;
    return Math.round(m / step) * step;
}
// Calorie counts are already the granularity an athlete reads off an erg
// display -- no false-precision concern the way meters has, and the
// chart's own figures aren't multiples of any clean step (12, 24, 36, 48),
// so this just rounds to the nearest whole calorie.
function roundCalories(cal) {
    return Math.round(cal);
}
/**
 * Converts a prescribed distance on one machine to its equivalent on
 * another, for both sexes, per the official CAP meters chart. Returns
 * whole-meter values pre-rounded for display (e.g. "500/400m Row" style
 * pairs) -- pass the result straight into a template, don't re-round it.
 *
 * Deliberately no from===to shortcut: Row and Ski Erg are the same
 * 'row_ski' chart column, so "convert 500m Ski to Row" IS a same-bucket
 * call, and it still needs the real female/male split (500/400), not the
 * input number echoed back unchanged for both sexes.
 */
export function convertDistance(distanceM, from, to) {
    const { female, male } = interpolate(METERS_CHART, distanceM, from, to);
    return { female: roundDistance(female), male: roundDistance(male) };
}
/**
 * Converts a prescribed calorie count on one machine to its equivalent on
 * another, per the official CAP calories chart -- same anchor-on-male-axis
 * approach as convertDistance, just against the calories table's own row
 * set. When `to` is 'run', the result is a METERS distance (the calories
 * table's own Run column is measured in meters, same as the meters chart),
 * not a calorie count -- you don't "run calories." Callers should label
 * that case accordingly rather than appending "Cal" to it.
 */
export function convertCalories(calories, from, to) {
    const { female, male } = interpolate(CALORIE_CHART, calories, from, to);
    if (to === 'run') {
        return { female: roundDistance(female), male: roundDistance(male) };
    }
    return { female: roundCalories(female), male: roundCalories(male) };
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
