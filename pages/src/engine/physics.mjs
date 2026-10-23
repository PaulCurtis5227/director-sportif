/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cycling power physics, shared by the live window and the offline analysis harness.
 * Pure functions, no DOM, no host imports — runs unchanged in Node.
 *
 * Units: speed m/s, mass kg, grade as a fraction (0.05 = 5%), power W, CdA m², altitude m.
 * Sauce's `state.speed` is km/h and `state.grade` is already a fraction (stats.mjs computes it as
 * Δaltitude/Δdistance) — convert speed with kmhToMs() at the boundary.
 *
 * EVERY constant here is an uncalibrated starting point. Zwift's real values are what the test
 * rides (RIDES.md) are for; the analysis harness fits CdA and Crr per rider from recordings.
 */

export const G = 9.80665;

/*
 * crr and cd are anchored to Zwift Insider's fixed-power speed tests (`npm run bike-data`): for a 183 cm /
 * 75 kg rider on road tyres, flat tests at 150 W + 300 W solve to rolling force ≈ 3.5 N (Crr ≈ 0.0042
 * at 84 kg) and a median road-frame CdA ≈ 0.311, which the Bassett area hits at cd ≈ 0.90. Gravel
 * tyres roll ~2x and MTB ~2.3x slower on tarmac. How CdA scales with OTHER heights/weights is still
 * uncalibrated (those tests use one rider size).
 */
export const DEFAULTS = Object.freeze({
    rho: 1.225,          // air density kg/m³ (sea-level standard; Zwift's value unverified)
    bikeMassKg: 5,       // frame + wheels: 3-parameter fits of 43 riders on the front of a group ride gave
                         // fitted mass − profile weight = +5.0 kg (median, 2026-09-27); Zwift Insider's
                         // Alpe tests imply ~4.6 kg for the Zwift Carbon. Known equipment: analysis/equipment.mjs
    crr: 0.0042,         // road tyres on tarmac (bike-data reference solve)
    cd: 0.90,            // applied to the Bassett frontal area -> 0.311 at 183 cm / 75 kg
    heightCm: 178,       // fallback when a rider's profile hides height
    weightKg: 75,        // fallback when a rider's profile hides weight
});

export function kmhToMs(kmh) {
    return kmh / 3.6;
}

export function msToKmh(ms) {
    return ms * 3.6;
}

function slope(grade) {
    const g = grade || 0;
    const h = Math.sqrt(1 + g * g);
    return {sin: g / h, cos: 1 / h};
}

/*
 * Rider + bike frontal area (m²) from height and mass — Bassett et al. (1999). A widely used
 * stand-in for Zwift's height/weight dependence, which the analysis harness will replace once
 * test rides pin it down.
 */
export function frontalArea(heightCm, weightKg) {
    return 0.0293 * (heightCm / 100) ** 0.725 * weightKg ** 0.425 + 0.0604;
}

/* Prior CdA for a rider; missing profile fields fall back to DEFAULTS. */
export function cdaPrior({heightCm, weightKg} = {}, {cd = DEFAULTS.cd} = {}) {
    return cd * frontalArea(heightCm || DEFAULTS.heightCm, weightKg || DEFAULTS.weightKg);
}

/* Aero power (W) with no draft at speed v. */
export function aeroPower(v, cda, rho = DEFAULTS.rho) {
    return 0.5 * rho * cda * v * v * v;
}

/*
 * Power breakdown to ride at speed `v` (m/s). `draftW` is the watts Zwift reports as saved
 * (`state.draft`), subtracted from aero. `accel` (m/s²) adds the kinetic-energy term.
 * `solo` is the same speed with no draft — the "what this speed would cost alone" figure.
 */
export function powerComponents({v, grade = 0, massKg, cda, crr = DEFAULTS.crr, rho = DEFAULTS.rho,
                                 accel = 0, draftW = 0}) {
    const {sin, cos} = slope(grade);
    const roll = crr * massKg * G * cos * v;
    const gravity = massKg * G * sin * v;
    const aero = aeroPower(v, cda, rho);
    const kinetic = massKg * accel * v;
    const solo = roll + gravity + aero + kinetic;
    return {roll, gravity, aero, kinetic, draft: draftW, solo, total: solo - draftW};
}

export function powerRequired(opts) {
    return powerComponents(opts).total;
}

/*
 * Steady-state speed (m/s) that `power` sustains. `draftFraction` (0..1) scales aero down —
 * convert Zwift's draft watts with draftFraction = draftW / aeroPower(vObserved, cda), since the
 * watts saved scale with v³. Bisection: required power is monotonic in v for v > 0 whenever the
 * rider isn't coasting down a hill faster than terminal speed, which we clamp at `vMax`.
 */
export function speedForPower({power, grade = 0, massKg, cda, crr = DEFAULTS.crr, rho = DEFAULTS.rho,
                               draftFraction = 0, vMax = 40}) {
    const effCda = cda * (1 - Math.min(Math.max(draftFraction, 0), 0.95));
    const need = v => powerComponents({v, grade, massKg, cda: effCda, crr, rho}).total;
    let lo = 0;
    let hi = vMax;
    if (need(hi) < power) {
        return hi;
    }
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (need(mid) < power) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return (lo + hi) / 2;
}
