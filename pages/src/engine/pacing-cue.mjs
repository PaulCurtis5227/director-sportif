/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Climb ahead: where the steep part is and how long, and "hold the wheel over the top". No power advice.
 *
 * Re-riding 14 climbs of the 2026-09-29 Innsbruck race, the best power shape depends on what the effort is assumed
 * to cost, and the three costs disagree. Energy: push the steep part. Normalized power (30 s averages, 4th
 * power): ride it evenly. Work above FTP (W′ / FRC): follow the grade, which is what the riders did; one constant
 * power at the same work above FTP loses ~1.6 s at the top, and shifting 10% around inside the climb moves things
 * by a few tenths at most. All three agree that easing below FTP (on the approach or the descent) can't pay for
 * extra effort on the climb. The sim can't tell which cost the body follows, so the cue only describes the road.
 * The crest is where races split (the sim kept each rider's draft as ridden, so it can't see a gap opening),
 * hence "hold the wheel over the top".
 * The road ahead comes from the map riders draw (BendMap.roadAhead: altitude and speed per spot).
 */

export const STEEP_MIN = 0.05;      // a steep section
export const STEEP_END = 0.035;     // the steep part is over below this
export const STEEP_MIN_SEC = 15;    // shorter ramps aren't worth announcing
export const LOOK_M = 400;          // announce a steep part this far ahead
export const ON_IT_M = 20;          // this close = you're on it
export const CLIMBING = 0.035;      // on a real climb (for the "top" cue; not every 2% rise)
export const TOP_SEC = 15;          // "top coming" this long before the crest
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
 * steep: the first steep section starting within LOOK_M, {startM, endM, grade, secs, endSec} (null if none);
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
    const i = grade >= STEEP_MIN && g[0] >= STEEP_END ? 0 : g.findIndex((x, k) => x >= STEEP_MIN && p[k].d <= LOOK_M);
    if (i >= 0) {
        let j = i;
        while (j + 1 < p.length && g[j] >= STEEP_END) {
            j++;
        }
        const dist = p[j].d - p[i].d;
        const startM = i === 0 && grade >= STEEP_MIN ? 0 : p[i].d;
        steep = {startM, endM: p[j].d, grade: dist > 0 ? (p[j].alt - p[i].alt) / dist : g[i],
                 secs: secsTo(p, j, vNow) - (startM > 0 ? secsTo(p, i, vNow) : 0), endSec: secsTo(p, j, vNow)};
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

/* profile: BendMap.roadAhead(...).pts; v: m/s; grade: your current grade (fraction). */
export function pacingCue({profile, v, grade = 0}) {
    const c = climbAhead(profile, {vNow: v, grade});
    if (!c) {
        return none;
    }
    const {steep, crest} = c;
    const onSteep = steep && steep.startM <= ON_IT_M;
    // The top is close (the crest is always past the steep part): the split risk is here, not a place to ease.
    if (grade >= CLIMBING && crest && crest.crestSec <= TOP_SEC) {
        return {state: 'top', crestM: crest.crestM,
                text: `Top in ~${Math.round(crest.crestSec)} s — hold the wheel over it, recover once the road is fast`};
    }
    // Nothing while you're on the steep part.
    if (steep && !onSteep && steep.secs >= STEEP_MIN_SEC) {
        return {state: 'ready', startM: steep.startM, grade: steep.grade,
                text: `Steep ${(steep.grade * 100).toFixed(1)}% in ${Math.round(steep.startM)} m, ${Math.round((steep.endM - steep.startM) / 10) * 10} m long`};
    }
    return none;
}
