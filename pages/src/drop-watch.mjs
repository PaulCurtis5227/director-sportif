/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Losing the group (v0.58.0; the user, 2026-11-06 Tour of Watopia stage 5: "I drifted off the back on purpose, got
 * dropped, didn't hear or see any calls"). The gap-opening call is "to warn me that I am about to get dropped, or be on
 * the wrong side of a split" (2026-11-05). GapWatch (position.mjs) watches the hole in front of your wheel, ride-away
 * the riders ahead leaving at 0.7+ m/s over 10 s, and both stop once you are more than ~1 s behind (your group is then
 * you alone). A slow drift (that ride: 5 -> 9 -> 14 -> 25 -> 32 m over 40 s, 0.4–0.6 m/s) was never seen.
 *
 * This watch remembers the riders you rode with: while the first of them is within DROP.withM ahead of you, they (and the
 * riders chained on from them, DROP.chainM apart) are
 * your group (their ids, refreshed every tick). After you lose them it keeps following those ids for DROP.keepS.
 *   dropping  the gap to the back of them (the rearmost of those ids) is DROP.minM+ and has grown DROP.growM+ above its lowest in the last
 *             DROP.windowS, and you're not closing it now (DROP.closingMps over the last DROP.nowS), all held DROP.holdS
 *             (a gap that jumps for one tick on a road Sauce has no map for is not a drop): "losing the group"
 * Once per drift: on for DROP.onS (said once; a long drop isn't told every 30 s), then on again only after you've been
 * back with them (within DROP.withM) for DROP.rearmS, or with a new group.
 *   new DropWatch().update(entries, me, wt) -> {state: 'dropping', gapM, growM, riders, fresh (its first tick)} or null
 */
import {leads} from './engine/wheels.mjs';

export const DROP = {withM: 6, chainM: 10, minM: 10, growM: 6, windowS: 30, keepS: 60, nowS: 4, closingMps: 0.3, maxM: 80,
                     rearmS: 15, minRiders: 1, use: 'min', holdS: 2, onS: 12};

const median = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

export class DropWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.group = null;     // {ids: Set, wt (last with them)}
        this.hist = [];        // [{wt, d: the gap to the back of the group}]
        this.since = null;     // the signs seen since (wt)
        this.onAt = null;      // this drift's call started (wt)
        this.armed = true;
        this.backSince = null; // with them again since (wt)
        this.last = null;
    }

    update(entries, me, wt, lead = leads(entries)) {
        const s = me && me.state, mine = me ? lead.get(me) : null;
        if (!s || mine == null || !Number.isFinite(wt)) return null;
        if (this.hist.length && wt <= this.hist.at(-1).wt) return this.last;
        const ahead = new Map();
        for (const o of entries || []) {
            const t = o && o.state;
            if (o === me || !t || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse) continue;
            const x = lead.get(o);
            if (x == null) continue;
            const d = x - mine;
            if (d > 0 && d <= DROP.maxM) ahead.set(o.athleteId, d);
        }
        // your group ahead: the first rider within DROP.withM, and every rider chained on from them (DROP.chainM apart)
        const sorted = [...ahead].sort((a, b) => a[1] - b[1]);
        const near = [];
        if (sorted.length && sorted[0][1] <= DROP.withM) {
            let prev = sorted[0][1];
            for (const [id, d] of sorted) {
                if (d - prev > DROP.chainM) break;
                near.push(id);
                prev = d;
            }
        }
        if (near.length >= DROP.minRiders) {
            // with a group: these are the riders you ride with (a rider who came past and left is no longer one)
            this.group = {ids: new Set(near), wt};
        } else if (this.group && wt - this.group.wt > DROP.keepS * 1000) {
            this.group = null;
            this.hist = [];
            this.armed = true;   // a new group next
        }
        let out = null;
        const seen = this.group ? [...this.group.ids].filter(id => ahead.has(id)).map(id => ahead.get(id)) : [];
        if (seen.length >= DROP.minRiders) {
            // the gap to the back of that group (its rearmost rider; DROP.use median: the middle of it)
            const d = DROP.use === 'median' ? median(seen) : Math.min(...seen);
            this.hist.push({wt, d});
            while (this.hist.length && this.hist[0].wt < wt - DROP.windowS * 1000) this.hist.shift();
            if (d <= DROP.withM) {
                if (this.backSince == null) this.backSince = wt;
                if (wt - this.backSince >= DROP.rearmS * 1000) this.armed = true;
            } else this.backSince = null;
            const low = Math.min(...this.hist.map(h => h.d));
            const recent = this.hist.find(h => h.wt >= wt - DROP.nowS * 1000);
            const rate = recent && wt - recent.wt >= 2000 ? (d - recent.d) / ((wt - recent.wt) / 1000) : 0;
            const signs = d >= DROP.minM && d - low >= DROP.growM && rate > -DROP.closingMps;
            if (!signs) this.since = null;
            else if (this.since == null) this.since = wt;
            if (signs && wt - this.since >= DROP.holdS * 1000 && this.armed) {
                this.armed = false;
                this.onAt = wt;
            }
            if (signs && this.onAt != null && wt - this.onAt <= DROP.onS * 1000) {
                out = {state: 'dropping', gapM: d, growM: d - low, riders: seen.length, fresh: wt === this.onAt};
            }
        } else {
            this.hist = [];
            this.since = null;
        }
        this.last = out;
        return out;
    }
}
