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
 */

export const AERO_BEST_S = 25;          // seconds from the line
export const AERO_WINDOW_S = [20, 28];  // FIRE inside this
export const AERO_WARN_S = 60;          // start the countdown
export const FEATHER_SEC = 30;
export const FEATHER_MIN_GRADE = 0.03;  // a climb worth a feather
export const FEATHER_LOOK_M = 600;
export const FEATHER_FIRE_M = 20;       // this close to the steep part = fire now

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
            if (!best || grade > best.grade) {
                best = {startM: p[i].d, grade, secs: t};
            }
        }
    }
    return best;
}

/* held: availablePowerUp; profile: BendMap.roadAhead(...).pts; v: m/s; grade: your current grade (fraction). */
export function featherCue({held, profile, v, grade = 0}) {
    if (held !== 'LIGHTNESS') {
        return none;
    }
    const s = steepestAhead(profile, {vNow: v});
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
