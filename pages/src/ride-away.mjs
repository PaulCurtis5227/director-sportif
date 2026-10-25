/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The group breaking up ahead of you (v0.45.0; the user, 2026-10-25 Tour of Watopia stage 3: "the group I was in was
 * getting stretched/broken. The back off/ease off warning was going off all the time while the front of the group was
 * pulling away", and "if you can't really tell what is going on maybe a call of group shattering, do what you can").
 * You can't be pushing into a wheel that is leaving, and easing off there only loses the group, so while this is on the
 * engine drops "ease off", "back off", "drop back", "drift back" and "easy" (and while shattering, holding your line
 * against a rider creeping up too) and says what is happening instead:
 *   away     the riders ahead ride away from you (their median lead grows RIDE_AWAY.awayMps+): "gap opening"
 *   shatter  the riders ahead split: the front of them leaves (RIDE_AWAY.frontMps+) while others don't (a spread of
 *            RIDE_AWAY.spreadMps+), held RIDE_AWAY.holdS after it was last seen: "group shattering"
 * In that ride: at the start the 100-rider group fell to 16, then 9, the riders ahead spreading by 0.8–1.3 m/s.
 * Thresholds from three rides (research in docs/FINDINGS.md, 2026-10-25): shattering ~8 min of that 80-min ride (a mass
 * group ride, broken up again and again), 2–2.5 min on each of the 10-22 / 10-23 group rides.
 *
 * Measured per rider, not on the group's front: the group splits and joins tick to tick when it stretches (100 riders,
 * then 16, then 42), so its front jumps. Each rider up to RIDE_AWAY.maxAheadM ahead on your road is followed by id:
 * their lead over you now vs RIDE_AWAY.windowS ago.
 *   new RideAwayWatch().update(entries, me, wt) -> {state: 'away' | 'shatter', mps (median), front, riders} or null
 */
import {leads} from './engine/wheels.mjs';

export const RIDE_AWAY = {windowS: 10, maxAheadM: 40, awayMps: 0.3, minRiders: 3,
                          frontMps: 0.8, spreadMps: 1.0, shatterRiders: 5, holdS: 20};

const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

export class RideAwayWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.hist = [];        // [{wt, rel: Map(athleteId -> meters ahead of you)}], the oldest about windowS back
        this.shatterAt = null; // when the split was last seen (wt)
        this.last = null;
    }

    update(entries, me, wt, lead = leads(entries)) {
        const s = me && me.state, mine = me ? lead.get(me) : null;
        if (!s || mine == null || !Number.isFinite(wt)) return null;
        if (this.hist.length && wt <= this.hist.at(-1).wt) return this.last;   // the same state again
        const rel = new Map();
        for (const o of entries || []) {
            const t = o && o.state;
            if (o === me || !t || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse) continue;
            const x = lead.get(o);
            if (x == null) continue;
            const d = x - mine;
            if (d > 0.5 && d <= RIDE_AWAY.maxAheadM) rel.set(o.athleteId, d);
        }
        this.hist.push({wt, rel});
        while (this.hist.length > 2 && this.hist[1].wt <= wt - RIDE_AWAY.windowS * 1000) this.hist.shift();
        const old = this.hist[0];
        const dt = (wt - old.wt) / 1000;
        const rates = [];
        if (dt >= RIDE_AWAY.windowS * 0.6 && dt <= RIDE_AWAY.windowS * 3) {
            for (const [id, d] of rel) {
                const d0 = old.rel.get(id);
                if (d0 != null) rates.push((d - d0) / dt);
            }
        }
        rates.sort((a, b) => a - b);
        let out = null;
        if (rates.length >= RIDE_AWAY.minRiders) {
            const mps = quantile(rates, 0.5), front = quantile(rates, 0.9);
            if (rates.length >= RIDE_AWAY.shatterRiders && front >= RIDE_AWAY.frontMps &&
                front - quantile(rates, 0.25) >= RIDE_AWAY.spreadMps) this.shatterAt = wt;
            out = mps >= RIDE_AWAY.awayMps ? {state: 'away', mps, front, riders: rates.length} : null;
        }
        if (this.shatterAt != null && wt - this.shatterAt <= RIDE_AWAY.holdS * 1000) {
            out = {state: 'shatter', mps: out ? out.mps : null, front: null, riders: rates.length};
        }
        this.last = out;
        return out;
    }
}
