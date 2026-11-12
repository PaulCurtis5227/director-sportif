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
// v0.72.4 (DS 0.66.0; the user, 2026-11-11 ToW stage 4: "The top of the hill call was a little optimistic, it was going
// off for little pauses in the slope, and missed the actual top"): a 8 -> 58 m climb with level bits at 36 m (10 s) and
// 54.5 m (12 s) got "top in 13" and "top in 12" at both, then nothing at the real top (58 m: its last 20 s at 3–4%,
// under CLIMBING, and the 12 s pause had restarted the climb's clock), and "steep in 11" for the same 7% after the first
// pause. Now: a crest is where the road stops rising FOR GOOD (no more than CREST_RISE_M over the next CREST_HOLD_M); the
// climb's clock survives dips up to CLIMB_DIP_S; the top is called on the last gentle bit too (TOP_GRADE); and on a
// climb a steep part must be steeper than the climb's own recent grade (ClimbClock.grade), not just than a pause.
export const CLIMB_DIP_S = 30;      // ClimbClock: a dip below CLIMBING this short doesn't end the climb (was 10)
export const CREST_HOLD_M = 150;    // a crest: the road no more than CREST_RISE_M above it over this much road after it
export const CREST_RISE_M = 2;
export const TOP_GRADE = 0.015;     // "top in N" while you still climb at least this (the last bit of a climb eases)
export const CLIMB_GRADE_S = 60;    // the climb's own grade: your average over this long, while on it
// "top in N" only on a real climb: its own grade at least this (rolling ground kept the clock running through 30 s dips:
// 2026-11-07 had six "tops" in 90 s at 0.2–1% averages)
export const TOP_CLIMB_GRADE = 0.025;
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
    // the crest: the first level point past the steep part that the road doesn't climb above again (a pause on the way
    // up is not the top); a profile that ends too soon after it can't say, so no crest then
    let crest = null;
    const from = steep ? p.findIndex(x => x.d >= steep.endM) : 0;
    for (let c = Math.max(0, from); c + 1 < p.length; c++) {
        if (g[c] >= 0.01) continue;
        let top = p[c].alt, k = c + 1;
        for (; k < p.length && p[k].d - p[c].d <= CREST_HOLD_M; k++) top = Math.max(top, p[k].alt);
        const seen = p[Math.min(k, p.length - 1)].d - p[c].d;
        if (top - p[c].alt > CREST_RISE_M) continue;   // it climbs on: a pause
        if (seen < CREST_HOLD_M / 2 && k >= p.length) break;   // the profile ends: can't tell
        crest = {crestM: p[c].d, crestSec: secsTo(p, c, vNow)};
        break;
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
        this.recent = [];   // [{wt, grade}] while on the climb, the last CLIMB_GRADE_S
        this.grade = null;  // the climb's own grade: your average over CLIMB_GRADE_S on it (null off a climb)
    }

    update(wt, grade) {
        if (!Number.isFinite(wt)) return 0;
        if (grade >= CLIMBING) {
            if (this.since == null || wt - this.lastUp > CLIMB_DIP_S * 1000) {
                this.since = wt;
                this.recent = [];
            }
            this.lastUp = wt;
        } else if (this.lastUp != null && wt - this.lastUp > CLIMB_DIP_S * 1000) {
            this.since = null;
        }
        if (this.since != null) {
            this.recent.push({wt, grade});
            while (this.recent.length && this.recent[0].wt < wt - CLIMB_GRADE_S * 1000) this.recent.shift();
            this.grade = this.recent.reduce((a, x) => a + x.grade, 0) / this.recent.length;
        } else {
            this.recent = [];
            this.grade = null;
        }
        return this.since == null ? 0 : (wt - this.since) / 1000;
    }
}

/*
 * profile: BendMap.roadAhead(...).pts; v: m/s; grade: your current grade (fraction); climbedS: seconds on this climb
 * (ClimbClock; leave it out and any rise counts); climbGrade: the climb's own recent grade (ClimbClock.grade), or null.
 */
export function pacingCue({profile, v, grade = 0, climbedS = Infinity, climbGrade = null}) {
    const c = climbAhead(profile, {vNow: v, grade});
    if (!c) {
        return none;
    }
    const {steep, crest} = c;
    const onSteep = steep && steep.startM <= ON_IT_M;
    // The top is close (the crest is always past the steep part): the split risk is here, not a place to ease. Still
    // climbing, gently or not (the last bit of a climb eases: v0.72.4)
    const realClimb = !Number.isFinite(climbGrade) || climbGrade >= TOP_CLIMB_GRADE;
    if (grade >= TOP_GRADE && climbedS >= TOP_AFTER_S && realClimb && crest && crest.crestSec <= TOP_SEC && crest.crestSec >= TOP_MIN_SEC) {
        return {state: 'top', crestM: crest.crestM,
                text: `Top in ~${Math.round(crest.crestSec)} s — hold the wheel over it, recover once the road is fast`};
    }
    // Nothing while you're on the steep part. On a climb (a pause included) only a part steeper than the climb itself
    const onClimb = climbedS > 0 && climbedS !== Infinity;
    const ref = onClimb && Number.isFinite(climbGrade) ? Math.max(grade, climbGrade) : grade;
    if (steep && !onSteep && steep.secs >= STEEP_MIN_SEC && ((!onClimb && grade < CLIMBING) || steep.core >= ref + STEEP_STEP)) {
        return {state: 'ready', startM: steep.startM, grade: steep.grade,
                text: `Steep ${(steep.grade * 100).toFixed(1)}% in ${Math.round(steep.startM)} m, ${Math.round((steep.endM - steep.startM) / 10) * 10} m long`};
    }
    return none;
}
