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
 *
 * v0.50.0 (2026-10-29 Tour of Watopia stage 4, 'group shattering' in a steady line of 5): with 5 riders the 90th
 * percentile IS the fastest one, so one rider coming past you (1.3 -> 9.7 m in 10 s) plus a lone rider 38 m up was a
 * shatter. Now RIDE_AWAY.leaveRiders+ riders must be leaving at frontMps+. And a lead that moved in a way their speed
 * can't explain (RIDE_AWAY.jumpMps off the speed difference: 0.9 -> 39.6 m in 10 s at +0.9 m/s, gaps switching from a
 * road Sauce has no map for) is a data jump, not a rider leaving: left out.
 * v0.52.0 (2026-10-31 Tour of Watopia stage 4, 4 of 5 "group shattering" calls marked bad): in a 20–100 rider bunch
 * two riders moving up the side are churn, not a split (9:30: 2 of 20 leaving, 22 of 23 riders still with you 30 s
 * on), and the front of a long bunch drawing out 20–40 m up isn't your group breaking (13:50: the nearest rider leaving
 * 21 m up, all 14 riders around you still there 30 s on). Now RIDE_AWAY.leaveShare of the riders ahead must be leaving,
 * the nearest of them within RIDE_AWAY.splitNearM of you now: the split is in your part of the
 * group; and the signs must be seen RIDE_AWAY.splitSeen times within RIDE_AWAY.splitWithinS (every one of the 12 calls
 * on 10-31 was one update). 10-31: 397 -> 23 s of shatter, only the start (75 riders around you, 25 left 30 s on);
 * 10-29: 111 -> 0 s.
 * v0.53.0 (2026-10-31, 4 "gap opening" calls marked bad, all of them 'away'): 3 m in 10 s is you easing to the wheel
 * you were told to give room to, not the group leaving. Of 96 'away' episodes on 10-27 / 10-29 / 10-31, 75 had those
 * riders < 5 m further up 15 s on. Now RIDE_AWAY.awayMps 0.5 (was 0.3), seen RIDE_AWAY.awaySeen times within
 * RIDE_AWAY.awayWithinS: 16 false left, 15 of 21 real kept (10-31: 3 of the 4 marks gone; the 4th was real, +12 m in 15 s).
 *   new RideAwayWatch().update(entries, me, wt) -> {state: 'away' | 'shatter', mps (median), front, riders} or null
 */
import {leads} from './engine/wheels.mjs';

export const RIDE_AWAY = {windowS: 10, maxAheadM: 40, awayMps: 0.5, minRiders: 3,
                          frontMps: 0.8, spreadMps: 1.0, shatterRiders: 5, holdS: 20,
                          leaveRiders: 2, leaveShare: 0.25, splitNearM: 15, splitSeen: 2, splitWithinS: 10, jumpMps: 2,
                          awaySeen: 2, awayWithinS: 10};

const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

export class RideAwayWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.hist = [];        // [{wt, rel: Map(athleteId -> {d: meters ahead of you, dv: their speed − yours, m/s})}], the oldest about windowS back
        this.shatterAt = null; // when the split was last seen (wt)
        this.splits = [];      // when the split signs were seen (wt): RIDE_AWAY.splitSeen within RIDE_AWAY.splitWithinS
        this.aways = [];       // when the riders ahead were seen riding away (wt): RIDE_AWAY.awaySeen within RIDE_AWAY.awayWithinS
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
            if (d > 0.5 && d <= RIDE_AWAY.maxAheadM) rel.set(o.athleteId, {d, dv: ((t.speed || 0) - (s.speed || 0)) / 3.6});
        }
        this.hist.push({wt, rel});
        while (this.hist.length > 2 && this.hist[1].wt <= wt - RIDE_AWAY.windowS * 1000) this.hist.shift();
        const old = this.hist[0];
        const dt = (wt - old.wt) / 1000;
        const rates = [];
        let nearestLeaving = Infinity;
        if (dt >= RIDE_AWAY.windowS * 0.6 && dt <= RIDE_AWAY.windowS * 3) {
            for (const [id, now] of rel) {
                const then = old.rel.get(id);
                if (!then) continue;
                const rate = (now.d - then.d) / dt;
                if (Math.abs(rate - (now.dv + then.dv) / 2) > RIDE_AWAY.jumpMps) continue;
                rates.push(rate);
                if (rate >= RIDE_AWAY.frontMps) nearestLeaving = Math.min(nearestLeaving, now.d);
            }
        }
        rates.sort((a, b) => a - b);
        let out = null;
        if (rates.length >= RIDE_AWAY.minRiders) {
            const mps = quantile(rates, 0.5), front = quantile(rates, 0.9);
            const leaving = rates.filter(r => r >= RIDE_AWAY.frontMps).length;
            if (rates.length >= RIDE_AWAY.shatterRiders && front >= RIDE_AWAY.frontMps &&
                leaving >= Math.max(RIDE_AWAY.leaveRiders, RIDE_AWAY.leaveShare * rates.length) &&
                nearestLeaving <= RIDE_AWAY.splitNearM && front - quantile(rates, 0.25) >= RIDE_AWAY.spreadMps) {
                this.splits.push(wt);
                while (this.splits[0] < wt - RIDE_AWAY.splitWithinS * 1000) this.splits.shift();
                if (this.splits.length >= RIDE_AWAY.splitSeen) this.shatterAt = wt;
            }
            if (mps >= RIDE_AWAY.awayMps) this.aways.push(wt);
            while (this.aways.length && this.aways[0] < wt - RIDE_AWAY.awayWithinS * 1000) this.aways.shift();
            out = mps >= RIDE_AWAY.awayMps && this.aways.length >= RIDE_AWAY.awaySeen ? {state: 'away', mps, front, riders: rates.length} : null;
        }
        if (this.shatterAt != null && wt - this.shatterAt <= RIDE_AWAY.holdS * 1000) {
            out = {state: 'shatter', mps: out ? out.mps : null, front: null, riders: rates.length};
        }
        this.last = out;
        return out;
    }
}
