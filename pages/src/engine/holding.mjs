/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Holding: the energy balance over 10–20 s (moved out of live-model.mjs, v0.55.0, so the Director Sportif mod can
 * carry it without the rest of the live model), and the "moving up / drifting back / holding place" state.
 */

export const HOLD_BAND_W = 20;   // the ± band Holding reads as "holding" (live-model.mjs WASTE_BAND_W, same value)

/*
 * Holding from an ENERGY BALANCE over a window (v0.50.0; research 2026-10-08, docs/FINDINGS.md "WHY HOLDING IS
 * NOISY"): your power minus what the window needed = the steady part (aero + rolling − draft + pack cost + matching
 * the group, averaged per tick) plus the change of kinetic + potential energy from the window's first tick to its
 * last (speed and altitude ends, not per-tick acceleration and grade, which swing ±90 W each on rollers and only
 * nearly cancel). Each tick's power is paired half with the tick before (the reported speed acts like the average
 * over the second: best mix 0.5 for trainers and power meters alike). Solo this is good to ±7 W over 5 s; in a pack
 * a slow pack effect stays (±19–37 W at 5 s by race), so the window is longer there.
 * Power-ups, coffee stops and teleports restart the window; coasting is fine (the balance holds at any power).
 */
export const HOLD_PAIR_S = 10;   // window with one other rider
export const HOLD_PACK_S = 20;   // in a group of 3+ (20 s ±27 W vs 30 s ±25: little gained by waiting longer)

export class HoldingMeter {
    constructor() {
        this.ticks = [];
    }

    reset() {
        this.ticks = [];
    }

    /*
     * tick: {wt (ms), v (m/s), alt (m), power (W), massKg, steadyW (aero + rolling − draft + pack cost + group term),
     * powerUp, coffee}; windowS: the averaging window. Returns {wastedW, bandW, valid, warmedUp, seconds}.
     */
    update(tick, windowS = HOLD_PACK_S) {
        const valid = !tick.powerUp && !tick.coffee && Number.isFinite(tick.steadyW) && Number.isFinite(tick.alt) &&
            Number.isFinite(tick.v) && tick.v * 3.6 >= 10;
        const last = this.ticks[this.ticks.length - 1];
        if (!valid || (last && tick.wt - last.wt > 3000)) {
            this.reset();
            if (!valid) return this.read(windowS, false);
        }
        if (!last || tick.wt > last.wt) {
            this.ticks.push({wt: tick.wt, v: tick.v, alt: tick.alt, power: Math.max(0, tick.power || 0), m: tick.massKg, steady: tick.steadyW});
        }
        while (this.ticks.length > 2 && this.ticks[this.ticks.length - 1].wt - this.ticks[1].wt > windowS * 1000) {
            this.ticks.shift();
        }
        return this.read(windowS, true);
    }

    read(windowS, valid) {
        const t = this.ticks;
        if (t.length < 3) return {wastedW: null, bandW: HOLD_BAND_W, valid, warmedUp: false, seconds: 0};
        const a = t[0], b = t[t.length - 1];
        const T = (b.wt - a.wt) / 1000;
        let P = 0, need = 0;
        for (let k = 1; k < t.length; k++) {
            const dt = (t[k].wt - t[k - 1].wt) / 1000;
            P += dt * (t[k].power + t[k - 1].power) / 2;
            need += dt * t[k].steady;
        }
        const m = b.m;
        const energy = 0.5 * m * (b.v ** 2 - a.v ** 2) + m * 9.80665 * (b.alt - a.alt);
        return {wastedW: (P - need - energy) / T, bandW: HOLD_BAND_W, valid, warmedUp: T >= windowS * 0.8, seconds: T};
    }
}

/* Holding shown = the 30 s residual minus a zero (0 since v0.33: the best spot is in the model), never more than you push. */
export function holdingW(wastedW, zeroW, power) {
    if (wastedW == null || !Number.isFinite(wastedW)) {
        return null;
    }
    return Math.min(wastedW - zeroW, Math.max(0, power));
}

/*
 * Moving up or drifting back through your group: your speed minus the group's median speed, smoothed (alpha 0.2 per
 * tick). Holding then reads as what the move costs, what drifting saves, or what holding your place costs.
 */
export const MOTION_MS = 0.14;   // m/s either way counts as moving

export class GroupMotion {
    constructor() {
        this.rel = null;
    }

    reset() {
        this.rel = null;
    }

    /* v and vGroup in m/s; returns the state line ('' until there is a group speed). */
    update(v, vGroup) {
        const rel = Number.isFinite(v) && Number.isFinite(vGroup) ? v - vGroup : null;
        this.rel = rel == null ? null : this.rel == null ? rel : this.rel + 0.2 * (rel - this.rel);
        return holdState(this.rel);
    }
}

export function holdState(rel) {
    return rel == null ? '' : rel > MOTION_MS ? 'moving up: what the move costs' :
        rel < -MOTION_MS ? 'drifting back: what it saves' : 'holding place';
}
