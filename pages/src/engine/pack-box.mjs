/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The box: Zwift's pack rule as measured (docs/PLAN.md §26; docs/FINDINGS.md 2026-11-16 "THE BOX IS A DRAFT CUT").
 * Sitting in line just behind a rider while you hold their speed or close on them, Zwift APPLIES only about BOX_FLOOR
 * (8%) of your air drag as draft while it still SHOWS the full draft (~36%): the box costs the difference, share ×
 * (reported draft − BOX_FLOOR × air), ~28% of air in the full box (70 W at 85 kg, 40 km/h; it grows with air drag, v³ and
 * your CdA, not m·v²). It never takes more than the draft you have (with no draft it costs nothing). Full from 1.0 to
 * 2.25 m center to center, fading to nothing by 5.25 m (wheel gap 3.75 m); dropping back or coming by at THROUGH_KMH+,
 * none (you get the full reported draft). v0.74.0 (DS v0.68.0); was 0.0036·m·v², full 1.25–3.0 m, gone at 3.25 m: that
 * fit mixed holding and dropping-back seconds and took the tail for a draft discount. The blocked "spikes" before the
 * box were timing noise in other riders' states (±66 W a second).
 * Read from where the riders are, no energy balance needed: so it can also say when you are about to enter it.
 *
 * Distances are center to center along the road (wheels.mjs leads, states aligned to one moment); the meters show Wheel
 * gap = this − BIKE_LENGTH_M. Pure: tested in Node.
 */

import {leads} from './wheels.mjs';

export const UNIT_PER_M = 113513;      // roadPosition units per meter sideways
export const BIKE_LENGTH_M = 1.5;      // center to center − wheel gap
export const BOX_FLOOR = 0.08;         // the draft Zwift applies in the full box, share of your air drag (research/2026-11-16/
                                       // box-fit.mjs: one rider ahead, holding, 1–2.5 m c-c: 31–37% shown, 8–9% applied)
// the shape, free (box-fit.mjs: 943k steady steps, 93k holding one rider's speed, zero = riders in the same groups with
// nobody ahead; the share of (shown − BOX_FLOOR) not applied): along, center to center
export const BOX_ALONG = [[0, 0], [0.25, 0.7], [0.5, 0.75], [1.0, 1], [2.25, 1], [2.5, 0.9], [3.0, 0.63], [3.5, 0.36],
                          [4.0, 0.3], [4.5, 0.14], [5.0, 0.05], [5.25, 0]];
export const BOX_FULL_FROM_M = 1.0;    // full from here...
export const BOX_FULL_TO_M = 2.25;     // ...to here, then fading
export const BOX_HALF_M = 3.24;        // half of it here (the "you're about to be in it" mark)
export const BOX_TO_M = 5.25;          // nothing from here
// sideways the cut is bounded by the draft, which already fades (0.25–0.5 m 27% of air, 0.75 m+ ~0): full to 0.6 m
export const BOX_FULL_SIDE_M = 0.6;    // full within this far to the side of their line...
export const BOX_NONE_SIDE_M = 0.8;    // ...fading to nothing here
export const OPENING_KMH = -0.3;       // you minus them: slower than this = dropping back, no box
export const THROUGH_KMH = 3;          // closing this much faster: coming through, no box (block-rule.mjs)
export const CLOSING_MIN_KMH = 0.1;    // closing at least this fast counts as "on the way in"
export const LOOK_M = 15;              // riders further ahead than this are not watched for the box

/* How much of the box this spot is in (0..1), from along (center to center, m) and aside (m, either side); speed aside. */
export function boxShare(along, aside) {
    if (!(along > 0 && along < BOX_TO_M)) return 0;
    let lengthwise = 0;
    for (let i = 1; i < BOX_ALONG.length; i++) {
        const [a0, f0] = BOX_ALONG[i - 1], [a1, f1] = BOX_ALONG[i];
        if (along <= a1) { lengthwise = f0 + (f1 - f0) * (along - a0) / (a1 - a0); break; }
    }
    const a = Math.abs(aside);
    if (a <= BOX_FULL_SIDE_M) return lengthwise;
    if (a >= BOX_NONE_SIDE_M) return 0;
    return lengthwise * (BOX_NONE_SIDE_M - a) / (BOX_NONE_SIDE_M - BOX_FULL_SIDE_M);
}

/* The box's cost (W): the draft not applied, for Zwift's reported draftW (W) and your undrafted air drag airW (W). */
export const boxW = (draftW, airW, share = 1) => (Number.isFinite(draftW) && Number.isFinite(airW) && airW > 0 && share > 0 ?
    share * Math.max(0, draftW - BOX_FLOOR * airW) : 0);

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
            const secs = Math.max(0, along - BOX_HALF_M) / (closingKmh / 3.6);
            if (!next || secs < next.secs) next = {rider: o, along, aside, closingKmh, secs};
        }
    }
    if (best) return {...best, secsToBox: next && best.share < 1 ? next.secs : null};   // in its blurred edge: the full part still ahead
    if (next) return {share: 0, rider: next.rider, along: next.along, aside: next.aside, closingKmh: next.closingKmh, secsToBox: next.secs};
    return {share: 0, rider: null, along: null, aside: null, closingKmh: null, secsToBox: null};
}
