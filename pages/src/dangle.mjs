/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dangling off the back (v0.61.0; the user, 2026-11-09 ToW stage 5, a double mark at 17:18: "I thought maybe I deserved
 * a close up there. I was dangling off the back a bit"): last of a strung-out group of 10, the wheel 5.5 m off (wheel
 * to wheel) at 41 km/h for ~15 s, no call: the spoken "close up" (meter-engine OFF_BACK) needs 10 m, and in watts a
 * seat 5 m back costs little (Position read 6–7 W). But the last wheel of a line at race speed is where you get gapped
 * when it snaps: staying in the pack outranks efficiency (call order). So: last in a group of DANGLE.minGroup+, at
 * DANGLE.minKmh+, the wheel DANGLE.minM+ ahead center to center (4 m wheel to wheel: past the 2–3.5 m best seat), not
 * closing it (DANGLE.closeMps over 2 s), for DANGLE.holdS: the same off-back call ("close up", and the Wheel gap red).
 * Once per dangle: armed again after DANGLE.rearmS within DANGLE.rearmM.
 * research/2026-11-09/dangle.mjs, 3.9 h of events since 11-05: 4.6 an hour; 11-09 it calls at 17:06, the user closed
 * it at 17:09–17:10 on their own.
 *   new DangleWatch().update({wt, inEvent, settling, draftless, groupSize, groupAhead, gapM (center to center), kmh}) -> bool
 */
export const DANGLE = {minM: 5.5, holdS: 3, minKmh: 33, minGroup: 3, closeMps: 0.5, rearmM: 4, rearmS: 10};

export class DangleWatch {
    constructor(o = DANGLE) {
        this.o = {...DANGLE, ...o};
        this.reset();
    }

    reset() {
        this.from = null;
        this.armed = true;
        this.nearFrom = null;
        this.on = false;
        this.recent = [];
    }

    update({wt, inEvent, settling, draftless, groupSize, groupAhead, gapM, kmh}) {
        const o = this.o;
        if (!Number.isFinite(wt)) return false;
        this.recent.push({wt, g: gapM});
        while (this.recent.length && this.recent[0].wt < wt - 2000) this.recent.shift();
        const first = this.recent[0];
        const closing = first && Number.isFinite(first.g) && Number.isFinite(gapM) && wt > first.wt &&
            (first.g - gapM) / ((wt - first.wt) / 1000) >= o.closeMps;
        const last = groupSize >= o.minGroup && groupAhead === groupSize - 1;
        const dangling = !!inEvent && !settling && !draftless && last && kmh >= o.minKmh && Number.isFinite(gapM) && gapM >= o.minM;
        this.from = dangling && !closing ? (this.from ?? wt) : null;
        if (!this.armed) {
            const near = !Number.isFinite(gapM) || gapM < o.rearmM;
            this.nearFrom = near ? (this.nearFrom ?? wt) : null;
            if (this.nearFrom != null && wt - this.nearFrom >= o.rearmS * 1000) {
                this.armed = true;
                this.nearFrom = null;
            }
        }
        // on once held; stays on while still dangling (closing included), off when it's over
        if (this.on && !dangling) this.on = false;
        if (!this.on && this.armed && this.from != null && wt - this.from >= o.holdS * 1000) {
            this.on = true;
            this.armed = false;
        }
        return this.on;
    }
}
