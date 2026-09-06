export type CapMachine = 'run' | 'row_ski' | 'c2_bike' | 'assault_echo_bike';
/**
 * Converts a prescribed distance on one machine to its equivalent on
 * another, for both sexes, per the official CAP chart. Returns whole-meter
 * values pre-rounded for display (e.g. "500/400m Row" style pairs) -- pass
 * the result straight into a template, don't re-round it.
 */
export declare function convertDistance(distanceM: number, from: CapMachine, to: CapMachine): {
    female: number;
    male: number;
};
/**
 * Given a distance prescribed on a machine the athlete doesn't have, and
 * the set of cardio machines they DO have, returns a converted-equivalent
 * option per owned machine (skipping `from` itself and 'run' unless the
 * athlete's equipment tags include it -- most gyms without a given erg
 * still have floor space to run, so callers typically always include
 * 'run' in `ownedMachines` regardless of what's in profile_equipment).
 */
export declare function machineScaleOptions(distanceM: number, from: CapMachine, ownedMachines: CapMachine[]): {
    machine: CapMachine;
    female: number;
    male: number;
}[];
export declare const CAP_MACHINE_LABEL: Record<CapMachine, string>;

