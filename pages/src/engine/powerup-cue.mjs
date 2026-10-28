/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * When to fire the power-up you're holding.
 *
 * AERO (drag −25% for 15 s) in a race finish: fire about 25 s from the line, as you come into the wind.
 * Re-riding four sprints (2026-09-29 Innsbruck race) with the AERO fired at every second, the best moment was
 * 22–28 s out for every rider (+0.55–1.00 s vs none); the last 15 s gave about a third less and top speed was
 * worst (+0.11–0.71 s). Speed gained early keeps paying to the line, and the AERO only cuts the drag you face,
 * so the wind-up off the wheel is the moment.
 *
 * Feather (rider weight −10% for 30 s) on a climb: fire at the start of the steepest 30 s. On 13 climbs of the
 * same race (each re-ridden with the same power at each point of the road) the best time at the top came from
 * firing 43–54 s before the top (the highest point) of a ~65 s climb, over the steep section (+2.6–3.0 s); "the
 * steepest 30 s" was within 0.06 s of it, the last 30 s about a quarter worse. The feather saves the most ENERGY
 * where you gain height fastest (near the foot, carrying speed), but each joule buys more time where you're
 * slower, so the best moment falls in between; anywhere 40–60 s out was within about 0.4 s of the best.
 * The climb ahead comes from the road map riders draw (BendMap.roadAhead: altitude and speed per spot).
 * A steeper climb further on wins (v0.68.8; the user, 2026-10-26 Watopia: "the call was to fire on the first slope. I held
 * until the second which was the correct thing to do"): it said FIRE on the first slope's 3.5% for one second, just
 * before the second climb's 10% came within 600 m. It looks all the way up the climb, or to the next arch that gives a
 * power-up (the user: "on the alp there are arches mid climb": a feather still held there gets you nothing new), whichever
 * comes first (limitM; climbTopM): a part FEATHER_BETTER steeper than the best within FEATHER_LOOK_M is the one: 'wait'
 * (keep it, no call) until it comes within FEATHER_LOOK_M.
 */

export const AERO_BEST_S = 25;          // seconds from the line
export const AERO_WINDOW_S = [20, 28];  // FIRE inside this
export const AERO_WARN_S = 60;          // start the countdown
export const FEATHER_SEC = 30;
export const FEATHER_MIN_GRADE = 0.03;  // a climb worth a feather
export const FEATHER_LOOK_M = 600;
export const FEATHER_FIRE_M = 20;       // this close to the steep part = fire now
export const FEATHER_BETTER = 0.01;     // a steeper part further up is worth keeping it for when this much steeper
export const CLIMB_RISE_M = 10;         // climbTopM: a climb rises this much ...
export const CLIMB_DROP_M = 15;         // ... and ends where the road has dropped this far below its top,
export const CLIMB_DROP_SHARE = 0.25;   // and this share of what it climbed: the dips inside Epic KOM (28 m of 363 m
                                        // forward, 23 m in reverse; the user: "careful on the volcano and the epic kom")

const none = {state: null, text: ''};

/*
 * held: the power-up in your pocket (gameState.availablePowerUp); remaining/remainingMetric: Sauce's distance
 * to the event finish; v: m/s; q: your draft as a fraction of your max (0..1).
 */
export function aeroCue({held, remaining, remainingMetric, v, q = 0}) {
    if (held !== 'AERO' || remainingMetric !== 'distance' || !(remaining > 0)) {
        return none;
    }
    const toLine = remaining / Math.max(v || 0, 4);
    if (toLine > AERO_WARN_S || toLine < 4) {
        return none;
    }
    if (toLine > AERO_WINDOW_S[1]) {
        const inM = remaining - AERO_BEST_S * Math.max(v || 0, 4);
        return {state: 'ready', toLine,
                text: `AERO: fire in ${Math.round(toLine - AERO_BEST_S)} s (~${Math.round(inM)} m), 25 s from the line`};
    }
    if (toLine >= AERO_WINDOW_S[0]) {
        return {state: 'fire', toLine,
                text: q >= 0.8 ? 'FIRE AERO as you come off the wheel — now or in the next few seconds' : 'FIRE AERO NOW'};
    }
    return {state: 'late', toLine, text: 'FIRE AERO NOW — late, still worth it'};
}

/*
 * The steepest ~30 s ahead, from the road profile [{d, alt, v}]: {startM, grade, secs} or null. Time per step
 * uses the riders' own speed there (a climb is ridden slower than the approach), else `vNow`.
 */
export function steepestAhead(pts, {vNow = 5, lookM = FEATHER_LOOK_M, sec = FEATHER_SEC} = {}) {
    const p = (pts || []).filter(x => Number.isFinite(x.alt) && Number.isFinite(x.d));
    if (p.length < 3) {
        return null;
    }
    let best = null;
    for (let i = 0; i + 1 < p.length && p[i].d <= lookM; i++) {
        let t = 0;
        let rise = 0;
        let dist = 0;
        for (let j = i; j + 1 < p.length && t < sec; j++) {
            const dd = p[j + 1].d - p[j].d;
            if (dd <= 0) {
                continue;
            }
            const vs = Math.max(2, ((p[j].v ?? vNow) + (p[j + 1].v ?? vNow)) / 2);
            t += dd / vs;
            rise += p[j + 1].alt - p[j].alt;
            dist += dd;
        }
        if (dist > 0 && t >= sec * 0.66) {
            const grade = rise / dist;
            if (!best || grade > best.grade + 1e-6) {   // a tie (a steady grade): the first, not rounding noise
                best = {startM: p[i].d, grade, secs: t};
            }
        }
    }
    return best;
}

/*
 * Meters to the top of the climb you're on or coming to, from a profile [{d, alt}]: the highest point before the road
 * drops below it by CLIMB_DROP_M and by CLIMB_DROP_SHARE of the climb's rise so far, once it has risen CLIMB_RISE_M (a
 * dip between two ramps stays one climb). The profile's end when it never drops that far (or no climb in it).
 * Checked on the map export's KOMs: Epic KOM both ways, Volcano KOM (3.5 m dip), Itza, Jarvis, Titans Grove, Alpe du
 * Zwift, Ventoux, Innsbruck: each one climb, start to banner.
 */
export function climbTopM(pts) {
    const p = (pts || []).filter(x => Number.isFinite(x.alt) && Number.isFinite(x.d));
    if (!p.length) {
        return 0;
    }
    let lo = Infinity;
    let top = null;
    for (const x of p) {
        if (!top) {
            lo = Math.min(lo, x.alt);
            if (x.alt - lo >= CLIMB_RISE_M) {
                top = {alt: x.alt, d: x.d};
            }
        } else if (x.alt > top.alt) {
            top = {alt: x.alt, d: x.d};
        } else if (x.alt <= top.alt - Math.max(CLIMB_DROP_M, CLIMB_DROP_SHARE * (top.alt - lo))) {
            return top.d;
        }
    }
    return p.at(-1).d;
}

/*
 * held: availablePowerUp; profile: the road ahead [{d, alt, v}] (as far as it goes: the whole climb, ideally); v: m/s;
 * grade: your current grade (fraction); archM: meters to the next arch that gives a power-up (null: not known).
 */
export function featherCue({held, profile, v, grade = 0, archM = null}) {
    if (held !== 'LIGHTNESS') {
        return none;
    }
    // nothing past the next arch, near or far: the race card says use it before (Spiral Summit replay: from the 14.0 km
    // arch it counted down to a ramp past the 14.9 km arch)
    const arch = Number.isFinite(archM) && archM > 0 ? archM : Infinity;
    const s = steepestAhead(profile, {vNow: v, lookM: Math.min(FEATHER_LOOK_M, arch)});
    const limitM = Math.min(climbTopM(profile), arch);
    const far = steepestAhead(profile, {vNow: v, lookM: limitM});
    if (far && far.startM > FEATHER_LOOK_M && far.grade >= FEATHER_MIN_GRADE &&
        (!s || far.grade >= s.grade + FEATHER_BETTER)) {
        return {state: 'wait', startM: far.startM, grade: far.grade,
                text: `Feather: keep it for the steeper part in ${Math.round(far.startM)} m (${(far.grade * 100).toFixed(1)}% for ~30 s)`};
    }
    if (!s || s.grade < FEATHER_MIN_GRADE) {
        return none;
    }
    const pct = (s.grade * 100).toFixed(1);
    if (s.startM <= FEATHER_FIRE_M || (grade >= FEATHER_MIN_GRADE && s.startM <= 2 * FEATHER_FIRE_M)) {
        return {state: 'fire', startM: s.startM, grade: s.grade, text: `FIRE FEATHER NOW — steepest part (${pct}% for ~30 s)`};
    }
    return {state: 'ready', startM: s.startM, grade: s.grade,
            text: `Feather: fire in ${Math.round(s.startM)} m, at the steepest part (${pct}% for ~30 s)`};
}
