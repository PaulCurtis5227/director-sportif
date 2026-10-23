/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The supertuck: when you are in it, when you could be, and what it does to your drag.
 *
 * Zwift's rules (Zwift Insider, zwiftinsider.com/supertuck, updated 2026-08-13): Zwift tucks you automatically at
 * ~58 km/h or more, on −3% or steeper, under 11 W, out of the draft (not in a pack); not on TT or MTB frames; any
 * rule failing ends it. No cadence rule. No drag numbers: "doesn't make you faster", rest only.
 * Measured (group ride 2026-10-16): in the one 7 s tuck the energy-balance CdA was 0.282–0.284, the same as coasting
 * just under 58 km/h (0.281–0.282) and pedaling (0.279): no drag cut. Four other tries coasted at 55–57 km/h, just
 * short of 58. So TuckDrag measures it on every tuck: a lower CdA in the tuck is the advantage, the same CdA is a
 * bug to file with Zwift (the graphic shows, the drag doesn't change).
 */

export const TUCK = {
    minKmh: 58,         // Zwift Insider: ~36 mph
    maxGrade: -0.03,    // −3% or steeper
    maxW: 11,           // under 11 W
    showKmh: 45,        // below this "+x km/h to tuck" is no use: blank
    coastKmh: 40,       // coasting from here up is the tuck's comparison (air drag dominates the balance)
    noFrames: ['tt', 'mtb'],
};

/*
 * Your tuck state now. kmh, grade (fraction), power (W), draft (W, Zwift's), bike (rider-model id).
 * {state: 'tucked' | 'ready' (fast enough, still pedaling: stop) | 'build' (needKmh more) | 'draft' (in the draft:
 * no tuck) | 'frame' (a TT or MTB frame), needKmh} or null off a descent.
 */
export function tuckState({kmh, grade, power, draft = 0, bike = null, powerUp = null} = {}) {
    if (!Number.isFinite(kmh) || !Number.isFinite(grade) || grade > TUCK.maxGrade) return null;
    if (TUCK.noFrames.includes(bike)) return {state: 'frame', needKmh: null};
    if (kmh < TUCK.showKmh) return null;
    if ((draft || 0) > 0) return {state: 'draft', needKmh: null};
    if (kmh >= TUCK.minKmh) return {state: (power || 0) < TUCK.maxW ? 'tucked' : 'ready', needKmh: 0};
    return {state: 'build', needKmh: TUCK.minKmh - kmh};
}

const RHO = 1.225;
const G = 9.80665;
export const TUCK_MIN_S = 3;   // seconds of each kind before a CdA is shown

/*
 * The drag in the tuck vs coasting just outside it, from the energy balance over each step between your states:
 *   CdA = (P·dt − Δ(½mv²) − m·g·Δh − Crr·m·g·Δd) / (½ρv³·dt)
 * Only steps where both ends are the same kind: 'tucked', or 'coast' (under 11 W, out of the draft, −3% or steeper,
 * from 40 up to 58 km/h: everything the same but the speed). Kept for the session.
 */
export class TuckDrag {
    constructor() {
        this.sum = {tucked: {num: 0, den: 0, s: 0}, coast: {num: 0, den: 0, s: 0}};
        this.last = null;
    }

    /* 'tucked' | 'coast' | null for a tick (t = tuckState now). */
    static kind(t, {kmh, power, draft, grade}) {
        if (t && t.state === 'tucked') return 'tucked';
        if (t && t.state === 'frame') return null;
        if (kmh >= TUCK.coastKmh && kmh < TUCK.minKmh && (power || 0) < TUCK.maxW && !((draft || 0) > 0) &&
            Number.isFinite(grade) && grade <= TUCK.maxGrade) return 'coast';
        return null;
    }

    /* x: {wt (ms), v (m/s), alt (m), dist (m), power, massKg, crr, kind ('tucked' | 'coast' | null), powerUp} */
    update(x) {
        const ok = Number.isFinite(x.wt) && Number.isFinite(x.v) && Number.isFinite(x.alt) && Number.isFinite(x.dist) &&
            x.v > 5 && !x.powerUp;
        const cur = ok ? {...x} : null;
        const a = this.last;
        this.last = cur;
        if (!a || !cur || !cur.kind || a.kind !== cur.kind) return;
        const dt = (cur.wt - a.wt) / 1000;
        const dd = cur.dist - a.dist;
        if (!(dt > 0 && dt <= 3) || !(dd > 0)) return;
        const m = cur.massKg, vm = (a.v + cur.v) / 2;
        const p = (a.power + cur.power) / 2;
        const num = p * dt - 0.5 * m * (cur.v ** 2 - a.v ** 2) - m * G * (cur.alt - a.alt) - cur.crr * m * G * dd;
        const s = this.sum[cur.kind];
        s.num += num;
        s.den += 0.5 * RHO * vm ** 3 * dt;
        s.s += dt;
    }

    /* {tucked: {cda, s} | null, coast: {cda, s} | null}: null until TUCK_MIN_S of that kind. */
    result() {
        const r = k => (this.sum[k].s >= TUCK_MIN_S && this.sum[k].den > 0 ? {cda: this.sum[k].num / this.sum[k].den, s: this.sum[k].s} : null);
        return {tucked: r('tucked'), coast: r('coast')};
    }
}

/* One line for the tile: the drag in the tuck vs coasting, once both are measured. */
export function tuckDragNote(res) {
    if (!res || !res.tucked) return '';
    const t = res.tucked.cda.toFixed(3);
    if (!res.coast) return `tuck CdA ${t} (${Math.round(res.tucked.s)} s)`;
    const pct = (res.tucked.cda / res.coast.cda - 1) * 100;
    return `tuck CdA ${t} vs ${res.coast.cda.toFixed(3)} coasting (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%)`;
}
