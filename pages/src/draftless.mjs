/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * You get no draft at all: a TT bike in a group ride, or a time trial. Zwift then reports 0 W of draft whoever is in
 * front of you (2026-10-24, a free ride on a TT bike: 0 W in 491 s with a rider 0–6 m ahead in line; on a road bike in
 * the race before it, 37 W on average in the same spot). The pack meters and their calls mean nothing then: 55 calls
 * in 40 min ("gap opening", "drop back", "rider behind"). This tells the engine to go quiet on them. It reads only your
 * own draft, so it needs no bike setting and covers TT events and road bikes in them too.
 * Pure: fed your own ticks.
 */

// v0.60.1: 10 s (was 20) at 25 km/h+ (2026-11-07 warm-up on the Hanzo: "gap opening", "drop back", "losing group" in the
// first 2 min: riders sat mostly beside you, 20 s on a wheel took 125 s). Slower, a road bike's draft can be ~1 W too
// (draft goes as speed cubed: 2 W on a wheel at 10 km/h), so slow ticks don't count.
export const DRAFTLESS_S = 10;          // this long on a wheel with 0 W of draft = you get none
export const DRAFTLESS_MIN_KMH = 25;    // ticks slower than this don't count
export const DRAFTLESS_WHEEL_M = [0.5, 6];   // the wheel: in line, this close (you'd draft from it on a road bike)
export const DRAFT_ZERO_W = 1;          // a draft this small is none
export const DRAFT_SOME_W = 5;          // a draft this big: you do get it (back to the pack calls at once)
const MAX_DT_S = 2;                     // a longer hole in the ticks counts this much

export class DraftlessWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.zeroS = 0;
        this.lastWt = null;
    }

    /*
     * tick: {wt (ms), draft (W, yours), gapM (the wheel in line ahead, m, or null), noDraftWheel (that wheel gives
     * no draft to anyone: not about you), kmh (your speed), sure (false: the gap is estimated, counts half)}. Returns true while you get no draft.
     */
    update({wt, draft, gapM, noDraftWheel = false, kmh = Infinity, sure = true}) {
        if (!Number.isFinite(wt)) return this.draftless;
        const dt = this.lastWt == null || wt <= this.lastWt ? 0 : Math.min(MAX_DT_S, (wt - this.lastWt) / 1000);
        if (this.lastWt == null || wt > this.lastWt) this.lastWt = wt;
        const d = Number.isFinite(draft) ? draft : 0;
        if (d > DRAFT_SOME_W) {
            this.zeroS = 0;
        } else if (d <= DRAFT_ZERO_W && !noDraftWheel && kmh >= DRAFTLESS_MIN_KMH && Number.isFinite(gapM) &&
                   gapM >= DRAFTLESS_WHEEL_M[0] && gapM <= DRAFTLESS_WHEEL_M[1]) {
            this.zeroS += sure ? dt : dt / 2;   // an estimated gap (road-gaps.mjs): the wheel may not be one
        }
        return this.draftless;
    }

    get draftless() {
        return this.zeroS >= DRAFTLESS_S;
    }
}
