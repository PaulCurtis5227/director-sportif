/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pack cost: the watts a spot in a bunch costs on top of what Zwift's reported draft says, read instantly from where
 * you are. Since v0.73.0 (DS v0.67.0, docs/PLAN.md §26) two parts: Zwift's box rule (pack-box.mjs: in line just
 * behind a rider, holding their speed or closing on them; the deepest box you are in, boxes don't add up; × m × v²,
 * 38 W at 85 kg and 40 km/h) and a discount on Zwift's draft near its cap: what it reports above DRAFT_KNEE of your air
 * drag is worth only 1 − DRAFT_DISCOUNT of its number (research/2026-11-12/box-overlap.mjs: 387k pack steps, rider
 * offsets fitted on no-draft seconds, scored out of sample: box + discount 22.5% of the 5 s scatter; the crowd steps
 * of box-crowd.mjs were mostly the box measured off the nearest rider instead of the deepest box, 21.5% with the box
 * right; draft-cap.mjs found the knee). Groups of 3+ for the discount (where it was fitted). It replaces the 2026-10-08 table (gap × riders within 3 m ahead × boxed, × rolling power, − group size):
 * its "room", "crowded", "boxed" and "front" watts were mostly a zero offset (riders' offsets fitted with their pack
 * seconds; docs/FINDINGS.md 2026-11-12 "ZERO OFFSET"), and its spikes timing noise. One module for both mods now (it
 * was the DS's own crude copy, scripts/sync-ds-engine.mjs DS_OWN).
 */

import {leads} from './wheels.mjs';
import {boxOf, boxW, UNIT_PER_M, BIKE_LENGTH_M} from './pack-box.mjs';

export {UNIT_PER_M};
export const IN_LINE_M = 0.5;       // "the wheel in line": within this sideways
export const NEAR_LAT_M = 1.5;      // riders that count as around you
export const DRAFT_KNEE = 0.27;      // share of your air drag above which Zwift's draft is worth less than reported...
export const DRAFT_DISCOUNT = 0.40;  // ...by this share of the excess (10.4 W per 0.1 of share at 260 W of air)
// Riders moving up through their group pay less than box + discount says (the user, 2026-11-12: "fix the Holding
// overcharge for riders moving up"; research/2026-11-12/mover-fit.mjs, 387k pack steps, test minutes: what the model
// left was −0.1 W level, −5.2 W at +1–3 km/h (mean +1.7), −13.9 W at +3–8 (mean +4.6): ~11 W per m/s faster than the
// group, both bands; the draft rate didn't remove it; dropping back −2 W, left alone)
export const MOVE_UP_CREDIT_W = 11;   // W per m/s faster than your group
export const DEFAULT_RIDER = {massKg: 80, cda: 0.28, crr: 0.0042};   // other riders: weight + 5 kg, own CdA, road Crr
const RHO = 1.225;

/*
 * Your situation from the riders around you (same road and direction): wheelGap (m center to center, the nearest rider
 * ahead within IN_LINE_M sideways, ≤ 25 m), ahead3 (riders 0–3 m ahead within NEAR_LAT_M), boxed (a rider < 1 m behind
 * within NEAR_LAT_M), box (pack-box.mjs boxOf: the box you are in and the one you are closing on). Null when you have
 * no state. lead = wheels.mjs leads(entries), passed in when asking for many riders.
 */
export function packSituation(entries, me, lead = null) {
    if (!me || !me.state) return null;
    const s = me.state;
    const L = lead || leads(entries);
    const mine = L.get(me);
    if (mine == null) return null;
    let wheelGap = null, ahead3 = 0, boxed = false;
    for (const o of entries) {
        if (o === me || !o.state || o.state.roadId !== s.roadId || !!o.state.reverse !== !!s.reverse) continue;
        const x = L.get(o);
        if (x == null) continue;
        const d = x - mine;
        const lat = Math.abs((o.state.roadPosition ?? 0) - (s.roadPosition ?? 0)) / UNIT_PER_M;
        if (d > 0 && d <= 25 && lat < IN_LINE_M && (wheelGap == null || d < wheelGap)) wheelGap = d;
        if (lat < NEAR_LAT_M && d > 0 && d < 3) ahead3++;
        if (lat < NEAR_LAT_M && d < 0 && d > -1) boxed = true;
    }
    return {wheelGap, ahead3, boxed, box: boxOf(entries, me, L)};
}

/* What Zwift's reported draft (W) overstates near its cap, for your undrafted air drag airW (W). */
export const draftDiscountW = (draftW, airW) => (Number.isFinite(draftW) && airW > 0 ? DRAFT_DISCOUNT * Math.max(0, draftW - DRAFT_KNEE * airW) : 0);

/*
 * The pack cost (W) for a rider {massKg (with the bike), cda} at v (m/s) with Zwift's reported draftW (W): the box you
 * are in (any group, a pair too: the box is one rider's) plus, in a group of 3+ (L = gap-curve.mjs groupLayout entry),
 * the draft discount, less MOVE_UP_CREDIT_W per m/s you ride faster than your group (L.vGroup), never below 0. Dropping
 * back needs no term: the box is off while you drop back.
 */
export function packCostW(sit, L, v, rider = DEFAULT_RIDER, draftW = 0) {
    if (!sit) return 0;
    const r = {...DEFAULT_RIDER, ...rider};
    const box = sit.box && sit.box.share > 0 ? boxW(r.massKg, v, sit.box.share) : 0;
    const airW = Number.isFinite(v) && v > 0 ? r.cda * 0.5 * RHO * v ** 3 : 0;
    const pack = L && L.size >= 3;
    const up = pack && Number.isFinite(L.vGroup) && Number.isFinite(v) ? Math.max(0, v - L.vGroup) : 0;
    return Math.max(0, box + (pack ? draftDiscountW(draftW, airW) : 0) - MOVE_UP_CREDIT_W * up);
}

/*
 * What your spot costs, as a state code (docs/DS-DATA.md): 'alone' | 'pair' | 'front' | 'box' (in a wheel's box) |
 * 'edge' (its edge) | 'room' (behind a wheel, clear of its box: the cheapest) | 'group' (no wheel in line). ('crowded'
 * went with the crowd steps, 2026-11-12.)
 */
export function packCostState(sit, {size, ahead}) {
    if (!sit || !(size >= 2)) return 'alone';
    const share = sit.box ? sit.box.share : 0;
    if (share >= 1) return 'box';
    if (share > 0) return 'edge';
    if (size === 2 && ahead === 0) return 'pair';
    if (ahead === 0) return 'front';
    if (sit.wheelGap != null && sit.wheelGap < 10) return 'room';
    return size === 2 ? 'pair' : 'group';
}

/* One line for the meter: what makes this spot cost what it does (gaps shown as Wheel gap). */
export function packCostNote(sit, L) {
    const state = packCostState(sit, L);
    const gap = sit && sit.box && sit.box.along != null ? `${(sit.box.along - BIKE_LENGTH_M).toFixed(1)} m off the wheel` : null;
    switch (state) {
    case 'alone': return 'not in a group';
    case 'box': return `in the wheel's box${gap ? `, ${gap}` : ''}: back off, step aside or come by`;
    case 'edge': return `edge of the wheel's box${gap ? `, ${gap}` : ''}`;
    case 'front': return 'front of the group';
    case 'pair': return 'with one rider';
    case 'room': return 'room: clear of the box, the cheapest spot';
    default: return 'in the group';
    }
}
