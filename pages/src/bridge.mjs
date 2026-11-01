/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bridging to the riders up the road (v0.52.0; the user, 2026-10-31 Tour of Watopia stage 4: "I would catch one rider,
 * with others a little up the road and I would get a back off message to hold the wheel, when I was trying to bridge").
 * While you bridge, advice about your gap to the wheel you just caught ("back off", "drift back") is beside the point.
 *
 * The riders up the road: on your road, up to BRIDGE.maxAheadM ahead, beyond the first hole of BRIDGE.holeM+ in front of
 * you (from you, or from the riders you're with: that hole must start within BRIDGE.holeFromM of you, so a gap far up
 * a big bunch isn't yours). Bridging: you've closed on them by BRIDGE.closeMps+ over BRIDGE.windowS (their rearmost
 * rider, followed by id; aligned leads, wheels.mjs).
 *   new BridgeWatch().update(entries, me, wt) -> {holeM, aheadM (to their rearmost), closeMps (+ = closing; null until
 *   known), vGroup (their median speed, m/s), riders, closing (closeMps >= BRIDGE.closeMps)} or null with nobody up the road
 */
import {leads} from './engine/wheels.mjs';
import {BRIDGE_PLAN} from './bridge-plan.mjs';

export const BRIDGE = {maxAheadM: 150, holeM: 8, holeFromM: 12, closeMps: 0.3, windowS: 10,
                       groupM: 30};   // their group: riders up to 30 m beyond their rearmost

export class BridgeWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.hist = [];   // [{wt, rel: Map(athleteId -> meters ahead of you)}], the oldest about windowS back
        this.last = null;
    }

    update(entries, me, wt, lead = leads(entries)) {
        const s = me && me.state, mine = me ? lead.get(me) : null;
        if (!s || mine == null || !Number.isFinite(wt)) return null;
        if (this.hist.length && wt <= this.hist.at(-1).wt) return this.last;
        const ahead = [];
        for (const o of entries || []) {
            const t = o && o.state;
            if (o === me || !t || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse) continue;
            const x = lead.get(o);
            if (x == null) continue;
            const d = x - mine;
            if (d > 0 && d <= BRIDGE.maxAheadM) ahead.push({id: o.athleteId, d, v: (t.speed || 0) / 3.6});
        }
        ahead.sort((a, b) => a.d - b.d);
        // the first hole in front of you
        let prev = 0, front = null;
        for (const a of ahead) {
            if (a.d - prev >= BRIDGE.holeM) {
                front = prev <= BRIDGE.holeFromM ? {id: a.id, d: a.d, holeM: a.d - prev} : null;
                break;
            }
            prev = a.d;
        }
        this.hist.push({wt, rel: new Map(ahead.map(a => [a.id, a.d]))});
        while (this.hist.length > 2 && this.hist[1].wt <= wt - BRIDGE.windowS * 1000) this.hist.shift();
        let out = null;
        if (front) {
            // their rearmost rider then (by id), against now
            const old = this.hist[0], dt = (wt - old.wt) / 1000;
            const then = dt >= BRIDGE.windowS * 0.6 && dt <= BRIDGE.windowS * 3 && old.rel.has(front.id) ? old.rel.get(front.id) : null;
            const closeMps = then != null ? (then - front.d) / dt : null;
            const group = ahead.filter(a => a.d >= front.d && a.d <= front.d + BRIDGE.groupM).map(a => a.v).sort((a, b) => a - b);
            out = {holeM: front.holeM, aheadM: front.d, closeMps, vGroup: group[group.length >> 1], riders: group.length,
                   closing: closeMps != null && closeMps >= BRIDGE.closeMps};
        }
        this.last = out;
        return out;
    }
}

/*
 * The bridge call (v0.53.0), only while you've asked for it (the Bridge button: the director can't know you want to go;
 * the user, 2026-10-31: "DS really needs to know intent"). Planned for the least FRC (bridge-plan.mjs), replanned every
 * BRIDGE_COACH.replanS:
 *   now      the cheapest start is now: "bridge now" (the note: attack W for the attack, then the hold W)
 *   last     now, and no start works later than BRIDGE_COACH.lastS from now: "last chance to bridge"
 *   later    a cheaper start ahead (a climb): "bridge on the climb in N" / "bridge in N"
 *   far      no start leaves the FRC reserve: "too far to bridge"
 *   (nothing before you go when they're under BRIDGE_COACH.minGapS up the road, or the best plan closes it within
 *   BRIDGE_COACH.minBridgeS: that's assumed bridgeable, not a bridge)
 *   attack   you went (closing BRIDGE_COACH.goMps+ above FTP): the attack's first seconds
 *   hold     pacing: the watts that close the rest for the least FRC, replanned as you go ("hold 350")
 *   made     on their wheel: "made it" (then the button turns itself off)
 *   new BridgeCoach().update({wt, armed, up (BridgeWatch), power, ftpW, plan: ({going}) => planBridge({..., attack: !going})})
 *   -> {state, ...} or null; done true = turn the button off
 */
export const BRIDGE_COACH = {replanS: 5, lastS: 15, goMps: 0.5, nowS: 5, holdStepW: 10, madeM: 6, madeHoldS: 6, lostS: 15,
                             maxHoldFtp: 3, minGapS: 3, minBridgeS: 5};   // maxHoldFtp: a backstop; the plan's own ceiling (bridge-plan.mjs) binds first

export class BridgeCoach {
    constructor() {
        this.reset();
    }

    reset() {
        this.plan = null;
        this.planAt = -Infinity;
        this.goneAt = null;     // when you went (wt)
        this.lastClose = null;  // last time you were closing (wt)
        this.lastAhead = null;  // the gap last seen (m)
        this.madeAt = null;
        this.attackW = null;
        this.farRun = 0;        // plans in a row with no bridge (+) / with one (−)
        this.wasFar = false;
    }

    update({wt, armed, up, power = 0, ftpW = 0, plan}) {
        if (!armed) {
            this.reset();
            return null;
        }
        if (this.madeAt != null) {
            if (wt - this.madeAt < BRIDGE_COACH.madeHoldS * 1000) return {state: 'made', done: false};
            this.reset();   // the next press starts fresh
            return {state: 'made', done: true};
        }
        // on: nobody up the road any more right after the gap was small, or the gap is small now
        if ((!up && this.lastAhead != null && this.lastAhead <= BRIDGE_COACH.madeM * 2) || (up && up.aheadM <= BRIDGE_COACH.madeM && this.goneAt != null)) {
            this.madeAt = wt;
            return {state: 'made', done: false};
        }
        if (!up) return null;
        this.lastAhead = up.aheadM;
        const closing = up.closeMps != null && up.closeMps >= BRIDGE_COACH.goMps;
        if (closing) this.lastClose = wt;
        if (this.goneAt == null && closing && power > ftpW) {
            this.goneAt = wt;
            this.attackW = this.plan && this.plan.best ? this.plan.best.attackW : null;
            this.planAt = -Infinity;   // replan as you go: the rest, no new attack
        }
        if (this.goneAt != null && (this.lastClose == null || wt - this.lastClose > BRIDGE_COACH.lostS * 1000)) this.goneAt = null;   // sat up
        if (wt - this.planAt >= BRIDGE_COACH.replanS * 1000) {
            this.plan = plan({going: this.goneAt != null});
            this.planAt = wt;
        }
        // a few seconds up the road at least, and more than a few seconds' work to close, or it isn't a bridge (the user,
        // 2026-10-31: "Anything else is just assumed to be bridgeable"): nothing to say before you go (once you've gone,
        // the pacing goes on to the wheel)
        const gapS = up.vGroup > 1 ? up.aheadM / up.vGroup : null;
        if (this.goneAt == null && (gapS == null || gapS < BRIDGE_COACH.minGapS)) return null;
        // "too far" only once two plans in a row say so, and back from it the same way (a descent flickers)
        const p = this.plan;
        if (this.planAt === wt) this.farRun = p ? Math.min(0, (this.farRun || 0) - 1) : Math.max(0, (this.farRun || 0)) + 1;
        const base = {aheadM: up.aheadM, riders: up.riders};
        if (this.goneAt != null) {
            const n = p && p.now;
            if (wt - this.goneAt < BRIDGE_PLAN.attackS * 1000) return {...base, state: 'attack', powerW: this.attackW ?? null};
            if (!n) return {...base, state: 'hold', powerW: null};
            // a sprint's watts aren't a pace to hold: no number then
            if (n.powerW > BRIDGE_COACH.maxHoldFtp * ftpW) return {...base, state: 'hold', powerW: null};
            return {...base, state: 'hold', powerW: Math.round(n.powerW / BRIDGE_COACH.holdStepW) * BRIDGE_COACH.holdStepW, secs: n.secs};
        }
        if (!p || this.wasFar && this.farRun > -2) {
            if (this.farRun >= 2) this.wasFar = true;
            if (this.wasFar) return {...base, state: 'far'};
            if (!p) return null;
        }
        this.wasFar = false;
        const b = p.best;
        if (b.secs <= BRIDGE_COACH.minBridgeS) return null;
        if (b.startS <= BRIDGE_COACH.nowS) {
            return {...base, state: p.lastStartS != null && p.lastStartS <= BRIDGE_COACH.lastS ? 'last' : 'now', attackW: b.attackW, powerW: b.powerW,
                    frcJ: b.frcJ, secs: b.secs};
        }
        return {...base, state: 'later', inS: b.startS, climb: b.climb >= 0.02, attackW: b.attackW, powerW: b.powerW, frcJ: b.frcJ,
                nowFrcJ: p.now ? p.now.frcJ : null};
    }
}
