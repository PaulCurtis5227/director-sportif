/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pack cost: the watts a spot in a bunch costs on top of what Zwift's reported draft says, read instantly from where
 * you are. A crude table: one figure per kind of spot (front, room, group, tight, crowded, boxed), scaled by speed.
 * Its own module, not a copy of the Efficiency Meter's (scripts/sync-ds-engine.mjs DS_OWN): checked against the full
 * model over seven rides, a few watts apart, the same words and calls (Efficiency Meter docs/PLAN.md §14).
 */

import {leads} from './wheels.mjs';

export const UNIT_PER_M = 113513;   // roadPosition units per meter sideways
export const IN_LINE_M = 0.5;       // "the wheel in line": within this sideways
export const NEAR_LAT_M = 1.5;      // riders that count as around you
// W at REF_KMH by spot kind (packCostState; boxed split by what's ahead: boxedRoom = 3.5 m+ to the wheel and under
// 2 riders close ahead); alone or in a pair: 0
export const SPOT_W = {front: 7, room: 10, group: 9, tight: 23, crowded: 26, boxed: 29, boxedRoom: 13};
export const DRIFT_BACK_W = -10;    // W per m/s slower than your group
export const MOVE_UP_W = -5;        // W per m/s faster than your group
export const ROAD_CRR = 0.0044;    // a road tyre on pavement: the figures are for this
export const REF_KMH = 37.4;
export const speedScale = v => (Number.isFinite(v) && v > 0 ? Math.max(0.5, Math.min(2, v * 3.6 / REF_KMH)) : 1);

/*
 * Your situation from the riders around you (same road and direction): wheelGap (m, the nearest rider ahead within
 * IN_LINE_M sideways, ≤ 25 m), ahead3 (riders 0–3 m ahead within NEAR_LAT_M), boxed (a rider < 1 m behind within
 * NEAR_LAT_M). Null when you have no state. lead = wheels.mjs leads(entries), passed in when asking for many riders.
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
    return {wheelGap, ahead3, boxed};
}

/*
 * The pack cost (W) for a situation in a group of `size` with `ahead` riders in front of you at v (m/s); 0 alone or
 * in a pair. It is extra rolling resistance, so rough roads and gravel tyres pay more: × rider.crr / ROAD_CRR.
 */
export function packCostW(sit, L, v, rider = null) {
    if (!sit || !L || !(L.size >= 3)) return 0;
    const roll = rider && rider.crr > 0 ? rider.crr / ROAD_CRR : 1;
    let kind = packCostState(sit, L);
    if (kind === 'boxed' && sit.ahead3 < 2 && !(sit.wheelGap != null && sit.wheelGap < 3.5)) kind = 'boxedRoom';
    return (SPOT_W[kind] || 0) * speedScale(v) * roll;
}

/* Moving through your group (drifting back, or moving up) costs less than the spot says (W, ≤ 0); m/s. */
export function foreAftW(v, vGroup) {
    if (!Number.isFinite(v) || !Number.isFinite(vGroup)) return 0;
    return v < vGroup ? DRIFT_BACK_W * (vGroup - v) : MOVE_UP_W * (v - vGroup);
}

/*
 * What makes your spot cost what it does, as a state code (docs/DS-DATA.md): 'alone' | 'pair' | 'front' | 'boxed' |
 * 'crowded' (2+ riders within 3 m ahead) | 'tight' (under 3.5 m to the wheel) | 'room' (3.5–5.5 m, open) | 'group'.
 */
export function packCostState(sit, {size, ahead}) {
    if (!sit || !(size >= 3)) return size === 2 ? 'pair' : 'alone';
    if (ahead === 0) return 'front';
    if (sit.boxed) return 'boxed';
    if (sit.ahead3 >= 2) return 'crowded';
    if (sit.wheelGap != null && sit.wheelGap < 3.5) return 'tight';
    if (sit.wheelGap != null && sit.wheelGap < 5.5 && sit.ahead3 === 0) return 'room';
    return 'group';
}

/* One line for the meter: what makes this spot cost what it does. */
export function packCostNote(sit, {size, ahead}) {
    if (!sit || !(size >= 3)) return size === 2 ? 'with one rider' : 'not in a group';
    if (ahead === 0) return 'front of the group';
    const parts = [];
    if (sit.wheelGap != null) parts.push(`${sit.wheelGap.toFixed(1)} m off the wheel`);
    if (sit.ahead3 >= 2) parts.push(`${sit.ahead3} riders close ahead`);
    if (sit.boxed) parts.push('boxed in');
    if (sit.wheelGap != null && sit.wheelGap >= 3.5 && sit.wheelGap < 5.5 && !sit.boxed && sit.ahead3 === 0) return 'room: the cheapest spot';
    return parts.join(', ') || 'in the group';
}
