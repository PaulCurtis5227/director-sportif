/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Effective draft: how much of Zwift's reported draft TYPICAL riders actually turn into speed.
 *
 * NOT a correction of Zwift's number: Zwift Insider's minimum-power TTT tests (PD 4.1.1: 24/32/39% saved
 * with 1/2/3 riders ahead) match the reported draft (28/34/40% in our recordings). Riders in real races
 * and group rides save less (14/19/21%) because they ride above that floor — Holding. Used for reports
 * ("what you got vs what was available"), not by the live tiles (v0.32.0).
 *
 * First read (v0.31) as "Zwift's draft watts overstate the real benefit": Energy balance on every rider of three
 * recordings (Innsbruck race 2026-09-29, pacer-bot rides 2026-09-28 and 2026-10-02; flat road, 5-sample
 * windows inside one group): riders pulling or alone balance to ~0 W, but riders in a draft get less
 * speed than power + draft should buy. Measured excess at full draft: ~30–45 W whatever the group size
 * (a pair 47–60 W), and it is NOT stickiness — riders pushing +60–75 W over their last 30 s at full
 * draft show the same excess. Fitted as a share of the reported draft, by draft share q (draft / your
 * max) and group size (riders in your group, split where a gap opens to > 1 s), scaled by speed^-1.5
 * (in watts the excess hardly grows with speed: 33–39 W from 25 to 45 km/h). Fitted to the MEDIAN rider,
 * so "Holding" reads ~0 for a typical rider in your spot.
 *
 * Pairs: the data (3 rides, ~3 min at q >= 0.9) says a single wheel at full draft saves almost
 * nothing, but it is thin and odd (partial draft in a pair saved more). Until protocol E (one steady
 * wheel) measures it, pairs use the 3–4 rider row.
 */

import {leads} from './wheels.mjs';

export const REF_KMH = 38;
export const SPEED_EXP = 1.5;
export const MAX_SHARE = 0.9;
export const GROUP_SPLIT_S = 1.0;

// Share of the reported draft that does not become speed, at REF_KMH. Knots in q; constant beyond.
const Q_KNOTS = [0.3, 0.575, 0.725, 0.9];
const ROWS = [
    {maxN: 4, share: [0.02, 0.08, 0.35, 0.40]},      // 2–4 riders (pair: see above)
    {maxN: 8, share: [0.38, 0.38, 0.38, 0.38]},
    {maxN: 30, share: [0.33, 0.33, 0.33, 0.33]},
    {maxN: Infinity, share: [0.24, 0.24, 0.24, 0.24]},
];

function rowFor(n) {
    return ROWS.find(r => n <= r.maxN);
}

/* Share of the reported draft lost (0..MAX_SHARE) at draft share q, group size n, speed v (m/s). */
export function excessShare(q, n, v) {
    if (!(q > 0) || !(n >= 2) || !(v > 0)) {
        return 0;
    }
    const s = rowFor(n).share;
    let base;
    if (q <= Q_KNOTS[0]) {
        base = s[0];
    } else if (q >= Q_KNOTS.at(-1)) {
        base = s.at(-1);
    } else {
        const i = Q_KNOTS.findIndex(k => k > q) - 1;
        const t = (q - Q_KNOTS[i]) / (Q_KNOTS[i + 1] - Q_KNOTS[i]);
        base = s[i] + t * (s[i + 1] - s[i]);
    }
    const speed = Math.min(2, Math.max(0.4, (v * 3.6 / REF_KMH) ** -SPEED_EXP));
    return Math.min(MAX_SHARE, base * speed);
}

/* {effectiveW, excessW}: reported draft split into what becomes speed and what doesn't. */
export function effectiveDraft({draftW, q, groupSize, v}) {
    const d = draftW > 0 ? draftW : 0;
    const excessW = d * excessShare(q, groupSize, v);
    return {effectiveW: d - excessW, excessW};
}

/*
 * The best effective draft this group offers you (W), as a share q of your max draft: max over q of
 * q·(1 − excess share). Position cost = this minus what you get now.
 */
export function bestEffectiveDraft({cap, v, groupSize, rho = 1.225}) {
    if (!(cap > 0) || !(v > 0)) {
        return 0;
    }
    const soloW = 0.5 * rho * v ** 3 * cap;
    let best = 0;
    for (let q = 0.05; q <= 1.0001; q += 0.05) {
        best = Math.max(best, q * (1 - excessShare(q, groupSize, v)));
    }
    return best * soloW;
}

/*
 * Your group: everyone on your road and direction, chained while each consecutive gap is <= GROUP_SPLIT_S
 * seconds (the same split the calibration used). Riders are placed at one moment (wheels.mjs leads: aligned
 * gapDistance, else the time gap). {size (incl. you), ahead (riders in it ahead of you)}.
 */
export function groupPosition(entries, me) {
    if (!me || !me.state || !Array.isArray(entries)) {
        return {size: 1, ahead: 0};
    }
    const road = me.state.roadId, rev = me.state.reverse;
    const pos = [];
    const lead = leads(entries);
    for (const o of entries) {
        const s = o.state;
        if (!s || s.roadId !== road || s.reverse !== rev) continue;
        const x = lead.get(o);
        if (x == null && o !== me) continue;
        // seconds behind the watched rider (time-gap units, so GROUP_SPLIT_S applies)
        pos.push({me: o === me, t: -(x ?? 0) / Math.max(3, (s.speed || 0) / 3.6)});
    }
    pos.sort((a, b) => a.t - b.t);
    const i = pos.findIndex(p => p.me);
    if (i < 0) {
        return {size: 1, ahead: 0};
    }
    let lo = i, hi = i;
    while (lo > 0 && pos[lo].t - pos[lo - 1].t <= GROUP_SPLIT_S) lo--;
    while (hi < pos.length - 1 && pos[hi + 1].t - pos[hi].t <= GROUP_SPLIT_S) hi++;
    return {size: hi - lo + 1, ahead: i - lo};
}

export function groupSizeAround(entries, me) {
    return groupPosition(entries, me).size;
}
