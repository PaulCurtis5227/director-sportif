/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A flyer: one or two riders jumping off the front of your bunch (v0.65.0; the user, 2026-11-09 ToW stage 5: at 18:19
 * the DS said "ease off" while a lone rider rode off the front: "I am thinking flyer").
 * v0.66.0 (the user, 2026-11-11 ToW stage 4: "Once they are two seconds up the road the issue is moot. The idea is to
 * give enough warning so that with some effort you can catch the wheel"): v0.65.0 waited for 20 m of clear road and
 * a gap growing over 15 s, so it spoke when they were gone (3:43, 7:31, 9:25, 11:55, 15:50). Now it watches the jump:
 *   your bunch: the riders chained to you on your road, each within FLYER.chainM of the next (behind you a little too);
 *   the front one or two of it (k), FLYER.minM+ clear of the rest and no more than FLYER.maxS seconds up, riding
 *   FLYER.dvKmh+ faster than the rest's median speed on each of the last FLYER.holdTicks updates, the gap grown
 *   FLYER.growM+ over FLYER.growS = jumping: "flyer, go" (once per flyer, FLYER.quietS apart), and while it goes no
 *   "ease off" (easing lets it go; held FLYER.holdS after the last sign). Speed against the bunch's median, not the
 *   gap alone: a turn at the front isn't a jump (the new front rider rides at the bunch's speed; the one swinging off
 *   slows). Your bunch of FLYER.minGroup+ (you counted), at FLYER.minKmh+, in an event.
 *   new FlyerWatch().update({entries, me, wt, lead, inEvent}) -> null or {state: 'away', riders, gapM, gapS, dvKmh, isNew, say, key}
 */
export const FLYER = {chainM: 25, behindM: 10, maxRiders: 2, minGroup: 4, minM: 3, maxS: 2.5, dvKmh: 3, holdTicks: 3,
                      growS: 3, growM: 2, holdS: 15, quietS: 60, sayS: 6, minKmh: 25,
                      powerX: 0, surgeX: 0};   // research: ... and at least surgeX × their own power over the 20 s before (0 = not used)   // research: the flyer's power at least this × the rest's median (0 = not used)

const median = a => {
    const s = [...a].sort((x, y) => x - y);
    return s.length ? s[s.length >> 1] : null;
};

export class FlyerWatch {
    constructor(o = {}) {
        this.o = {...FLYER, ...o};
        this.reset();
    }

    reset() {
        this.hist = new Map();     // key -> [{wt, gap, ok}] the last few updates of that front k
        this.pw = new Map();       // athleteId -> [{wt, w}] their power, the last 25 s (surgeX)
        this.awayKey = null;       // the flyer going now
        this.awayAt = null;
        this.called = new Set();
        this.calledAt = -Infinity;
        this.lastWt = null;
        this.last = null;
    }

    update({entries, me, wt, lead, inEvent = true}) {
        const o = this.o, s = me && me.state;
        if (!s || !Number.isFinite(wt) || !lead) return (this.last = null);
        if (this.lastWt != null && wt <= this.lastWt) return this.last;   // the same state again
        this.lastWt = wt;
        if (!inEvent || !(s.speed >= o.minKmh)) return this._out(wt, null);
        const bunch = this._bunch(entries, me, lead);
        if (o.surgeX > 0) {
            for (const r of bunch) {
                if (!Number.isFinite(r.state.power)) continue;
                const a = this.pw.get(r.athleteId) || [];
                if (!a.length || a.at(-1).wt < wt) a.push({wt, w: r.state.power});
                while (a.length && a[0].wt < wt - 25e3) a.shift();
                this.pw.set(r.athleteId, a);
            }
        }
        const surged = r => {
            const a = this.pw.get(r.athleteId) || [];
            const before = a.filter(x => x.wt < wt - 3e3);
            if (before.length < 8 || !Number.isFinite(r.state.power)) return false;
            return r.state.power >= o.surgeX * before.reduce((t, x) => t + x.w, 0) / before.length;
        };
        if (bunch.length < o.minGroup) return this._out(wt, null);
        let best = null;
        for (let k = 1; k <= o.maxRiders && k < bunch.length - 2; k++) {
            const front = bunch.slice(0, k), rest = bunch.slice(k);
            // your own attack is no flyer (v0.67.0; 2026-11-13 ToW stage 2 12:37: you went off the front of 15 at 300–340 W
            // and were told "flyer, away", then pressed Mark)
            if (front.includes(me)) continue;
            const gap = lead.get(front[k - 1]) - lead.get(rest[0]);
            const vRest = median(rest.map(r => r.state.speed || 0));
            const dv = Math.min(...front.map(r => r.state.speed || 0)) - vRest;   // km/h: each of them faster
            const pRest = median(rest.map(r => r.state.power).filter(Number.isFinite));
            const pFront = Math.min(...front.map(r => (Number.isFinite(r.state.power) ? r.state.power : 0)));
            const powerOk = (!(o.powerX > 0) || (pRest > 0 && pFront >= o.powerX * pRest)) && (!(o.surgeX > 0) || front.every(surged));
            const key = front.map(r => r.athleteId).sort().join(',');
            const h = this.hist.get(key) || [];
            h.push({wt, gap, ok: gap >= o.minM && gap <= o.maxS * Math.max(vRest / 3.6, 3) && dv >= o.dvKmh && powerOk});
            while (h.length && h[0].wt < wt - Math.max(o.growS, 10) * 1000) h.shift();
            this.hist.set(key, h);
            const recent = h.slice(-o.holdTicks);
            const then = h.find(x => x.wt >= wt - o.growS * 1000);
            const jumping = recent.length >= o.holdTicks && recent.every(x => x.ok) && then && gap - then.gap >= o.growM;
            if (jumping && (!best || gap > best.gap)) best = {key, riders: k, gap, dv, v: vRest};
        }
        for (const [key, h] of this.hist) if (!h.length || h.at(-1).wt < wt - 10e3) this.hist.delete(key);
        if (best) {
            this.awayKey = best.key;
            this.awayAt = wt;
        }
        return this._out(wt, best);
    }

    _out(wt, f) {
        const o = this.o;
        if (!f) {
            // still going a moment after the last sign (the voice may be on another call), then quiet
            if (this.last && this.awayAt != null && wt - this.awayAt <= o.holdS * 1000) {
                return (this.last = {...this.last, isNew: false, say: this.last.say && wt - this.calledAt <= o.sayS * 1000});
            }
            return (this.last = null);
        }
        let isNew = false;
        if (!this.called.has(f.key) && wt - this.calledAt >= o.quietS * 1000) {
            this.called.add(f.key);
            this.calledAt = wt;
            isNew = true;
        }
        const vMs = Math.max(f.v / 3.6, 3);
        return (this.last = {state: 'away', riders: f.riders, gapM: Math.round(f.gap), gapS: Math.round(f.gap / vMs * 10) / 10,
                             dvKmh: Math.round(f.dv), isNew, say: this.called.has(f.key) && wt - this.calledAt <= o.sayS * 1000,
                             key: f.key});
    }

    /* Your bunch, front first: the riders on your road chained to you (each within chainM of the next), from behindM behind you. */
    _bunch(entries, me, lead) {
        const s = me.state, mine = lead.get(me);
        const road = (entries || []).filter(o => o && o.state && o.state.roadId === s.roadId && !!o.state.reverse === !!s.reverse &&
                                                 lead.get(o) != null && lead.get(o) >= mine - this.o.behindM)
            .sort((a, b) => lead.get(b) - lead.get(a));
        const i = road.indexOf(me);
        if (i < 0) return [];
        let a = i, b = i;
        while (a > 0 && lead.get(road[a - 1]) - lead.get(road[a]) <= this.o.chainM) a--;
        while (b + 1 < road.length && lead.get(road[b]) - lead.get(road[b + 1]) <= this.o.chainM) b++;
        return road.slice(a, b + 1);
    }
}

/* The call's words: "flyer, go" / "two flyers, go": said while the wheel can still be caught. */
export function flyerWord(f) {
    if (!f) return '';
    return `${f.riders >= 2 ? 'two flyers' : 'flyer'}, go`;
}
