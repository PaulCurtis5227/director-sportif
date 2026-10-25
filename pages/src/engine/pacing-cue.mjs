/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Climb ahead: where the steep part is and how long, and "hold the wheel over the top". No power advice.
 *
 * Re-riding 14 climbs of the 2026-09-29 Innsbruck race, the best power shape depends on what the effort is assumed
 * to cost, and the three costs disagree. Energy: push the steep part. A surge-weighted average (30 s
 * averages, 4th power): ride it evenly. Work above FTP (W′ / FRC): follow the grade, which is what the riders did; one constant
 * power at the same work above FTP loses ~1.6 s at the top, and shifting 10% around inside the climb moves things
 * by a few tenths at most. All three agree that easing below FTP (on the approach or the descent) can't pay for
 * extra effort on the climb. The sim can't tell which cost the body follows, so the cue only describes the road.
 * The crest is where races split (the sim kept each rider's draft as ridden, so it can't see a gap opening),
 * hence "hold the wheel over the top".
 * The road ahead comes from the map riders draw (BendMap.roadAhead: altitude and speed per spot).
 * v0.68.3 (DS 0.40.0; Climber's Gambit 2026-10-24): a steep part must AVERAGE STEEP_MIN (one 5% kink in a 4.6% climb
 * was "steep in 100 … 65 … 30" while you climbed it); on a climb only a part STEEP_STEP steeper than where you are;
 * "over top" only after TOP_AFTER_S of climbing (ClimbClock) and not under TOP_MIN_SEC away (rollers: "over top in 1").
 */

export const STEEP_MIN = 0.05;      // a steep section
export const STEEP_END = 0.035;     // the steep part is over below this
export const STEEP_MIN_SEC = 15;    // shorter ramps aren't worth announcing
export const LOOK_M = 400;          // announce a steep part this far ahead
export const ON_IT_M = 20;          // this close = you're on it
export const CLIMBING = 0.035;      // on a real climb (for the "top" cue; not every 2% rise)
export const TOP_SEC = 15;          // "top coming" this long before the crest
export const TOP_MIN_SEC = 5;       // ...but not closer than this (over it before the words are out)
export const TOP_AFTER_S = 30;      // ...and only after this long climbing (a roller isn't a climb)
export const STEEP_STEP = 0.015;    // on a climb, a steep part ahead must be this much steeper than where you are
export const CLIMB_DIP_S = 10;      // ClimbClock: a dip below CLIMBING this short doesn't end the climb
const SMOOTH_M = 40;                // grade measured over this much road

const none = {state: null, text: ''};

/* Grade over SMOOTH_M centered on each point (smooths the noise where spots are close together). */
export function smoothedGrades(p) {
    const g = [];
    let a = 0;
    let b = 0;
    for (let i = 0; i < p.length; i++) {
        while (a < i && p[i].d - p[a].d > SMOOTH_M / 2) {
            a++;
        }
        while (b + 1 < p.length && p[b + 1].d - p[i].d <= SMOOTH_M / 2) {
            b++;
        }
        // Spots can be 20–100 m apart on long roads: always span at least to a neighbor.
        if (b === i && i + 1 < p.length) {
            b = i + 1;
        } else if (a === i && i > 0) {
            a = i - 1;
        }
        const dd = p[b].d - p[a].d;
        g.push(dd > 5 ? (p[b].alt - p[a].alt) / dd : (g.length ? g[g.length - 1] : 0));
    }
    return g;
}

/*
 * Seconds from you (d = 0) to point j. The spots' speeds are every passing rider's average (dropped riders
 * included), so they give the SHAPE; scale them to your pace where you are now.
 */
export function secsTo(p, j, vNow) {
    const scale = p[0].v > 1 ? Math.min(2, Math.max(0.6, vNow / p[0].v)) : 1;
    let t = 0;
    let prevD = 0;
    let prevV = vNow;
    for (let k = 0; k <= j && k < p.length; k++) {
        const vk = p[k].v != null ? p[k].v * scale : vNow;
        t += (p[k].d - prevD) / Math.max(2, (prevV + vk) / 2);
        prevD = p[k].d;
        prevV = vk;
    }
    return t;
}

/*
 * The climb ahead from the road profile [{d, alt, v}] (d = meters from you):
 * steep: the first section starting within LOOK_M that averages STEEP_MIN, {startM, endM, grade (its average), core
 * (the average while it stays STEEP_MIN), secs, endSec} (null if none);
 * crest: where the road stops rising, {crestM, crestSec} (null if it doesn't within the profile).
 * grade = your current grade; when you're already on a steep bit the section starts at you.
 */
export function climbAhead(pts, {vNow = 5, grade = 0} = {}) {
    const p = (pts || []).filter(x => Number.isFinite(x.alt) && Number.isFinite(x.d) && x.d > 0);
    if (p.length < 4) {
        return null;
    }
    const g = smoothedGrades(p);
    let steep = null;
    // the first part that averages STEEP_MIN: it starts at a point that steep and runs while the road stays above
    // STEEP_END; a 4.6% climb with a 5% kink isn't steep, so look on past it
    let look = 0;
    while (!steep && look < p.length) {
        const k0 = look === 0 && grade >= STEEP_MIN && g[0] >= STEEP_END ? 0 :
            g.findIndex((x, k) => k >= look && x >= STEEP_MIN && p[k].d <= LOOK_M);
        if (k0 < 0) break;
        let j = k0;
        while (j + 1 < p.length && g[j] >= STEEP_END) {
            j++;
        }
        const dist = p[j].d - p[k0].d;
        const avg = dist > 0 ? (p[j].alt - p[k0].alt) / dist : g[k0];
        if (avg >= STEEP_MIN) {
            const startM = k0 === 0 && grade >= STEEP_MIN ? 0 : p[k0].d;
            let c = k0;   // the core: while the road stays STEEP_MIN (what a climber feels as the steep bit)
            while (c + 1 <= j && g[c + 1] >= STEEP_MIN) c++;
            const core = p[c].d > p[k0].d ? (p[c].alt - p[k0].alt) / (p[c].d - p[k0].d) : g[k0];
            steep = {startM, endM: p[j].d, grade: avg, core,
                     secs: secsTo(p, j, vNow) - (startM > 0 ? secsTo(p, k0, vNow) : 0), endSec: secsTo(p, j, vNow)};
        }
        look = j + 1;
    }
    let crest = null;
    const from = steep ? p.findIndex(x => x.d >= steep.endM) : 0;
    for (let c = Math.max(0, from); c + 1 < p.length; c++) {
        if (g[c] < 0.01) {
            crest = {crestM: p[c].d, crestSec: secsTo(p, c, vNow)};
            break;
        }
    }
    return {steep, crest};
}

/*
 * How long you've been climbing (grade >= CLIMBING), for "over top": a dip under CLIMB_DIP_S doesn't end it.
 * update(wtMs, grade) -> seconds on this climb (0 off one).
 */
export class ClimbClock {
    constructor() {
        this.since = null;
        this.lastUp = null;
    }

    update(wt, grade) {
        if (!Number.isFinite(wt)) return 0;
        if (grade >= CLIMBING) {
            if (this.since == null || wt - this.lastUp > CLIMB_DIP_S * 1000) this.since = wt;
            this.lastUp = wt;
        } else if (this.lastUp != null && wt - this.lastUp > CLIMB_DIP_S * 1000) {
            this.since = null;
        }
        return this.since == null ? 0 : (wt - this.since) / 1000;
    }
}

/*
 * profile: BendMap.roadAhead(...).pts; v: m/s; grade: your current grade (fraction); climbedS: seconds on this climb
 * (ClimbClock; leave it out and any rise counts).
 */
export function pacingCue({profile, v, grade = 0, climbedS = Infinity}) {
    const c = climbAhead(profile, {vNow: v, grade});
    if (!c) {
        return none;
    }
    const {steep, crest} = c;
    const onSteep = steep && steep.startM <= ON_IT_M;
    // The top is close (the crest is always past the steep part): the split risk is here, not a place to ease.
    if (grade >= CLIMBING && climbedS >= TOP_AFTER_S && crest && crest.crestSec <= TOP_SEC && crest.crestSec >= TOP_MIN_SEC) {
        return {state: 'top', crestM: crest.crestM,
                text: `Top in ~${Math.round(crest.crestSec)} s — hold the wheel over it, recover once the road is fast`};
    }
    // Nothing while you're on the steep part.
    if (steep && !onSteep && steep.secs >= STEEP_MIN_SEC && (grade < CLIMBING || steep.core >= grade + STEEP_STEP)) {
        return {state: 'ready', startM: steep.startM, grade: steep.grade,
                text: `Steep ${(steep.grade * 100).toFixed(1)}% in ${Math.round(steep.startM)} m, ${Math.round((steep.endM - steep.startM) / 10) * 10} m long`};
    }
    return none;
}
