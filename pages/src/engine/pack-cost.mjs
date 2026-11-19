/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pack cost: the watts a spot in a bunch costs on top of what Zwift's reported draft says, read instantly from where
 * you are. v0.74.0 (DS v0.68.0, docs/FINDINGS.md 2026-11-16 "THE BOX IS A DRAFT CUT"): the box alone (pack-box.mjs: in line
 * behind a rider, holding their speed or closing on them, Zwift applies ~8% of your air drag as draft while showing the
 * full draft; the deepest box you are in, boxes don't add up). Outside the box Zwift's reported draft is what you get
 * (research/2026-11-16/draft-look.mjs: 5 m+ center to center, 30+ km/h, ±1–3 points at every count of riders ahead), so
 * the v0.73.0 draft discount (reported draft above 27% of air worth 60%) is gone: it was the box's tail, past 3.25 m. It replaces the 2026-10-08 table (gap × riders within 3 m ahead × boxed, × rolling power, − group size):
 * its "room", "crowded", "boxed" and "front" watts were mostly a zero offset (riders' offsets fitted with their pack
 * seconds; docs/FINDINGS.md 2026-11-12 "ZERO OFFSET"), and its spikes timing noise. One module for both mods now (it
 * was the DS's own crude copy, scripts/sync-ds-engine.mjs DS_OWN).
 */

import {leads} from './wheels.mjs';
import {boxOf, boxW, UNIT_PER_M, BIKE_LENGTH_M} from './pack-box.mjs';

export {UNIT_PER_M};
export const IN_LINE_M = 0.5;       // "the wheel in line": within this sideways
export const NEAR_LAT_M = 1.5;      // riders that count as around you
// Riders moving up through their group pay less than box + discount says (the user, 2026-11-12: "fix the Holding
// overcharge for riders moving up"; research/2026-11-12/mover-fit.mjs, 387k pack steps, test minutes: what the model
// left was −0.1 W level, −5.2 W at +1–3 km/h (mean +1.7), −13.9 W at +3–8 (mean +4.6): ~11 W per m/s faster than the
// group, both bands; the draft rate didn't remove it; dropping back −2 W, left alone)
export const MOVE_UP_CREDIT_W = 11;   // W per m/s faster than your group
// v0.74.0: the box fades (BOX_ALONG), so "in it" and "its edge" are shares: 0.9+ = in the box, 0.15+ = its edge
export const BOX_STATE_FULL = 0.9, BOX_STATE_EDGE = 0.15;
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

/*
 * The pack cost (W) for a rider {massKg (with the bike), cda} at v (m/s) with Zwift's reported draftW (W): the box you
 * are in (any group, a pair too: the box is one rider's): the reported draft it doesn't apply, less MOVE_UP_CREDIT_W per
 * m/s you ride faster than your group of 3+ (L = gap-curve.mjs groupLayout entry, L.vGroup), never below 0. Dropping
 * back needs no term: the box is off while you drop back.
 */
export function packCostW(sit, L, v, rider = DEFAULT_RIDER, draftW = 0) {
    if (!sit) return 0;
    const r = {...DEFAULT_RIDER, ...rider};
    const airW = Number.isFinite(v) && v > 0 ? r.cda * 0.5 * RHO * v ** 3 : 0;
    const box = sit.box && sit.box.share > 0 ? boxW(draftW, airW, sit.box.share) : 0;
    const pack = L && L.size >= 3;
    const up = pack && Number.isFinite(L.vGroup) && Number.isFinite(v) ? Math.max(0, v - L.vGroup) : 0;
    return Math.max(0, box - MOVE_UP_CREDIT_W * up);
}

/*
 * What your spot costs, as a state code (docs/DS-DATA.md): 'alone' | 'pair' | 'front' | 'box' (in a wheel's box) |
 * 'edge' (its edge) | 'room' (behind a wheel, clear of its box: the cheapest) | 'group' (no wheel in line). ('crowded'
 * went with the crowd steps, 2026-11-12.)
 */
export function packCostState(sit, {size, ahead}) {
    if (!sit || !(size >= 2)) return 'alone';
    const share = sit.box ? sit.box.share : 0;
    if (share >= BOX_STATE_FULL) return 'box';
    if (share >= BOX_STATE_EDGE) return 'edge';
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
