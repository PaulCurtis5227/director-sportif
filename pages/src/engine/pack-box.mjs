/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The box: Zwift's pack rule as measured (docs/PLAN.md §26; docs/FINDINGS.md 2026-11-12 block-rule, block-shift,
 * block-weight, box-shape). Sitting in line just behind a rider, closer than about one bike length of clear road, slows
 * you: a steady loss P = BOX_K × m × v² (m with bike, kg; v m/s; 85 kg at 40 km/h = 38 W), on at once, the same whether
 * you push or not, gone when you come by at THROUGH_KMH or more faster than them. It replaces the pack-cost table and
 * the blocked "spikes" (those were timing noise in other riders' states, ±66 W a second, over this steady loss).
 * Read from where the riders are, no energy balance needed: so it can also say when you are about to enter it.
 *
 * Distances are center to center along the road (wheels.mjs leads, states aligned to one moment); the meters show Wheel
 * gap = this − BIKE_LENGTH_M. Pure: tested in Node.
 */

import {leads} from './wheels.mjs';

export const UNIT_PER_M = 113513;      // roadPosition units per meter sideways
export const BIKE_LENGTH_M = 1.5;      // center to center − wheel gap
export const BOX_K = 0.0036;           // W per (kg × (m/s)²): 38 W at 85 kg, 40 km/h (box-overlap.mjs: the deepest box from
                                       // every rider ahead, fitted with the draft discount; block-weight.mjs's contrast 0.0037)
// the shape (research/2026-11-12/box-shape.mjs, 570k pack steps, scored out of sample): in line, center to center, the
// loss is full from 1.25 to 3.0 m (30–37 W at race speed), about half from 0.5 to 1.25 m (wheels overlapping: 13–20 W)
// and in the last quarter meter (3.0–3.25 m: our position timing blurs the sharp back edge); sideways full to 0.2 m,
// nothing from 0.8 m. Only while you hold their speed or close on them: dropping back away from them, no box (that
// alone took the fit from 4.8% to 6.6% of the 5 s scatter explained).
export const BOX_FROM_M = 0.5;         // along, center to center: from here...
export const BOX_FULL_FROM_M = 1.25;   // ...half until here, full...
export const BOX_FULL_TO_M = 3.0;      // ...until here, half...
export const BOX_TO_M = 3.25;          // ...until here
export const BOX_FULL_SIDE_M = 0.2;    // full within this far to the side of their line...
export const BOX_NONE_SIDE_M = 0.8;    // ...fading to nothing here
export const OPENING_KMH = -0.3;       // you minus them: slower than this = dropping back, no box
export const THROUGH_KMH = 3;          // closing this much faster: coming through, no box (block-rule.mjs)
export const CLOSING_MIN_KMH = 0.1;    // closing at least this fast counts as "on the way in"
export const LOOK_M = 15;              // riders further ahead than this are not watched for the box

/* How much of the box this spot is in (0..1), from along (center to center, m) and aside (m, either side); speed aside. */
export function boxShare(along, aside) {
    if (!(along >= BOX_FROM_M && along < BOX_TO_M)) return 0;
    const lengthwise = along >= BOX_FULL_FROM_M && along < BOX_FULL_TO_M ? 1 : 0.5;
    const a = Math.abs(aside);
    if (a <= BOX_FULL_SIDE_M) return lengthwise;
    if (a >= BOX_NONE_SIDE_M) return 0;
    return lengthwise * (BOX_NONE_SIDE_M - a) / (BOX_NONE_SIDE_M - BOX_FULL_SIDE_M);
}

/* The box's cost (W) for a rider of massKg (with bike) at v (m/s) in share of it. */
export const boxW = (massKg, v, share = 1) => (Number.isFinite(massKg) && Number.isFinite(v) && v > 0 ? BOX_K * massKg * v * v * share : 0);

/*
 * You against the riders ahead on your road and direction: {share (0..1, the box you are in now), rider (the rider whose
 * box it is, or the one you are closing on), along, aside (m; aside + = you are to their right), closingKmh (you minus
 * them, km/h; + = closing), secsToBox (seconds until you reach their box at this closing speed: in line within
 * BOX_NONE_SIDE_M, closing CLOSING_MIN_KMH..THROUGH_KMH, not yet in its full part; else null)}. Null without a state.
 * The box with the biggest share wins; with none, the nearest rider you are closing on.
 */
export function boxOf(entries, me, lead = null) {
    if (!me || !me.state) return null;
    const s = me.state;
    const L = lead || leads(entries);
    const mine = L.get(me);
    if (mine == null) return null;
    let best = null, next = null;
    for (const o of entries || []) {
        if (o === me || !o.state || o.state.roadId !== s.roadId || !!o.state.reverse !== !!s.reverse) continue;
        const x = L.get(o);
        if (x == null) continue;
        const along = x - mine;
        if (!(along > 0 && along <= LOOK_M)) continue;
        const aside = ((s.roadPosition ?? 0) - (o.state.roadPosition ?? 0)) / UNIT_PER_M * (s.reverse ? -1 : 1);
        const closingKmh = (s.speed || 0) - (o.state.speed || 0);
        const through = closingKmh >= THROUGH_KMH;
        const share = through || closingKmh < OPENING_KMH ? 0 : boxShare(along, aside);
        if (share > 0 && (!best || share > best.share || (share === best.share && along < best.along))) {
            best = {share, rider: o, along, aside, closingKmh};
        }
        if (along >= BOX_FULL_TO_M && Math.abs(aside) < BOX_NONE_SIDE_M && closingKmh >= CLOSING_MIN_KMH && !through && !(share > 0.5)) {
            const secs = Math.max(0, along - BOX_FULL_TO_M) / (closingKmh / 3.6);
            if (!next || secs < next.secs) next = {rider: o, along, aside, closingKmh, secs};
        }
    }
    if (best) return {...best, secsToBox: next && best.share < 1 ? next.secs : null};   // in its blurred edge: the full part still ahead
    if (next) return {share: 0, rider: next.rider, along: next.along, aside: next.aside, closingKmh: next.closingKmh, secsToBox: next.secs};
    return {share: 0, rider: null, along: null, aside: null, closingKmh: null, secsToBox: null};
}
