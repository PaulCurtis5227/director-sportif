/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Gaps on roads Sauce has no map for (EM v0.69.0 / DS v0.50.0). 2026-10-29 Tour of Watopia stage 4: on Watopia's new
 * roads (course 6 roads 193–212) EVERY rider came with gapDistance 0. Sauce (stats.mjs _getRoadDistance) returns 0 when
 * its map data has no curve for the road, and 0 is finite, so wheels.mjs took it as real: each rider's lead became
 * their state age × speed, the equal gaps sorted in Sauce's list order, and Gap read 0–1 m in a 100-rider bunch while
 * the ride-away / gap watches called "group shattering" (570 of 647 gap-call seconds were on those roads).
 *
 * The tell: riders on your road at a different road completion with a distance of exactly 0 (a real distance between
 * two different spots is never exactly 0). Then the road is broken for the session (Sauce's map won't change), and:
 *   - riders on your road: the distance from Zwift's own road completion, scaled by your own odometer
 *     (Δ state.distance / Δ roadCompletion over your last ROAD_GAPS.scaleM on this road; signed, so the direction of
 *     travel needs no rule); until you have ridden that far on the road, no gap at all (blank, not wrong)
 *   - riders on other roads: no gap (Sauce's sums run through the broken road)
 * Off a broken road, riders ON a broken road lose their gap too (the part through their road is 0).
 * Time gaps (`gap`) go with the distance: they come from the same road histories.
 *
 *   new RoadGaps().update(all, me) -> {entries, source: 'sauce' | 'road' | 'none'}
 *     source 'road' = repaired from road completion, 'none' = your road is broken and the scale isn't known yet
 */

export const ROAD_GAPS = {
    zeroShare: 0.8,     // this share of the riders tested with an exact 0: the road has no map
    scaleM: 10,         // the scale over your last 10 m on this road: road completion isn't even along a road, so it is
                        // local. Against Sauce on roads it knows (2026-10-27 race, research/2026-10-29/road-gap-check.mjs):
                        // riders 5–15 m away |error| P50 0.3 m / P90 1.6 m over 10 m, 0.5 / 3.5 over 50 m, 1.2 / 5.2 over 15 s
    keepS: 60,          // your track is kept this long (slow climbs need it to cover scaleM)
    jumpM: 100,         // more than this between two of your ticks (or a jump in completion): a teleport, start over
    jumpRc: 50000,      // road completion units in one tick that can't be riding (a wrap or a teleport)
    maxLeadM: 300,      // further than this along: no gap (a loop road's wrap, or simply too far to matter)
};

export const roadKey = s => `${s.courseId ?? '?'}/${s.roadId}`;

const sameWay = (a, b) => a.roadId === b.roadId && !!a.reverse === !!b.reverse;

/*
 * Do Sauce's distances on your road look like a missing map? true / false, or null when nobody on your road can tell
 * (no rider at a different road completion). tested = how many riders were looked at.
 */
export function sauceGapsBroken(entries, me) {
    const s = me && me.state;
    if (!s || !Number.isFinite(s.roadCompletion)) return {broken: null, tested: 0};
    let tested = 0, zero = 0;
    for (const o of entries || []) {
        const t = o && o.state;
        if (!t || o === me || !sameWay(t, s) || !Number.isFinite(t.roadCompletion) || t.roadCompletion === s.roadCompletion) continue;
        if (o.gapDistance == null) continue;   // no history with you: says nothing either way
        tested++;
        if (o.gapDistance === 0) zero++;
    }
    return {broken: tested ? zero / tested >= ROAD_GAPS.zeroShare : null, tested};
}

export class RoadGaps {
    constructor() {
        this.broken = new Set();   // road keys Sauce has no map for (this session)
        this.track = [];           // your recent states on your road: [{wt, rc, dist}]
        this.trackOn = null;       // which road (key + direction) the track is on
    }

    /* A different meter rider (a camera change): their track starts over; the broken roads stay. */
    restart() {
        this.track = [];
        this.trackOn = null;
    }

    /* Your own state: the odometer against the road completion, on this road only. */
    learn(s) {
        if (!Number.isFinite(s.worldTime) || !Number.isFinite(s.roadCompletion) || !Number.isFinite(s.distance)) return;
        const on = `${roadKey(s)}${s.reverse ? 'r' : ''}`;
        const last = this.track.at(-1);
        if (on !== this.trackOn || (last && (s.distance - last.dist > ROAD_GAPS.jumpM || s.distance < last.dist ||
                Math.abs(s.roadCompletion - last.rc) > ROAD_GAPS.jumpRc))) {
            this.trackOn = on;
            this.track = [];
        }
        if (last && this.track.length && s.worldTime <= last.wt) return;
        this.track.push({wt: s.worldTime, rc: s.roadCompletion, dist: s.distance});
        while (this.track.length > 2 && this.track[1].wt <= s.worldTime - ROAD_GAPS.keepS * 1000) this.track.shift();
    }

    /* Meters per road-completion unit along your direction of travel here (signed), or null not known yet. */
    scale() {
        const b = this.track.at(-1);
        for (let i = this.track.length - 2; i >= 0; i--) {
            const a = this.track[i], dm = b.dist - a.dist, drc = b.rc - a.rc;
            if (dm >= ROAD_GAPS.scaleM) return drc !== 0 ? dm / drc : null;
        }
        return null;
    }

    update(all, me) {
        const s = me && me.state;
        if (!s || !Array.isArray(all)) return {entries: all, source: 'sauce'};
        this.learn(s);
        const test = sauceGapsBroken(all, me);
        const key = roadKey(s);
        // two riders saying so marks the road for the session; one is enough for this tick
        if (test.broken && test.tested >= 2) this.broken.add(key);
        const mine = test.broken === true || this.broken.has(key);
        const others = !mine && this.broken.size > 0 && all.some(o => o && o !== me && o.state && this.broken.has(roadKey({...o.state, courseId: o.state.courseId ?? s.courseId})));
        if (!mine && !others) return {entries: all, source: 'sauce'};
        const k = mine ? this.scale() : null;
        const base = Number.isFinite(me.gapDistance) ? me.gapDistance : 0;
        const entries = all.map(o => {
            const t = o && o.state;
            if (!t || o === me) return o;
            if (mine) {
                if (k != null && sameWay(t, s) && Number.isFinite(t.roadCompletion)) {
                    const lead = (t.roadCompletion - s.roadCompletion) * k;
                    if (Math.abs(lead) <= ROAD_GAPS.maxLeadM) return {...o, gap: undefined, isGapEst: true, gapDistance: base - lead};
                }
                return {...o, gap: undefined, isGapEst: true, gapDistance: undefined};
            }
            return this.broken.has(roadKey({...t, courseId: t.courseId ?? s.courseId})) ?
                {...o, gap: undefined, isGapEst: true, gapDistance: undefined} : o;
        });
        return {entries, source: mine ? (k != null ? 'road' : 'none') : 'sauce'};
    }
}
