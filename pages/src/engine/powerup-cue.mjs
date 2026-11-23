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
 * v0.70.1 (DS v0.53.0; the user, 2026-10-31 Tour of Watopia stage 4: the feather countdown rose 85 -> 95 s, and "FEATHER
 * now" ran 40 s): (1) a steep part just past FEATHER_LOOK_M looked like the steepest 30 s INSIDE it, cut at the edge
 * (~596 m) and moving with you: the meters stayed put, you slowed on the climb, the seconds rose. A best part that runs
 * into the steeper one past the edge is that part: 'wait' until it's in. (2) FeatherPick holds the target where it is on
 * the road (a new one must be FEATHER_BETTER steeper), "fire" only from FEATHER_FIRE_M before it to FEATHER_FIRE_AFTER_S
 * into it, and a target passed with the feather unused is spent: nothing again on that climb unless a part
 * FEATHER_BETTER steeper comes (the steepest 30 s just ahead of you slid along a long even drag: fire, ready, fire).
 */

export const AERO_BEST_S = 25;          // seconds from the line
export const AERO_WINDOW_S = [20, 28];  // FIRE inside this
export const AERO_WARN_S = 60;          // start the countdown
export const FEATHER_SEC = 30;
export const FEATHER_MIN_GRADE = 0.03;  // a climb worth a feather
export const FEATHER_LOOK_M = 600;
export const FEATHER_FIRE_M = 20;       // this close to the steep part = fire now
export const FEATHER_BETTER = 0.01;     // a steeper part further up is worth keeping it for when this much steeper
export const FEATHER_FIRE_AFTER_S = 10;  // FeatherPick: "fire" up to this far into the steep part, then it's spent
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
                best = {startM: p[i].d, grade, secs: t, endM: p[i].d + dist};
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
 * The last meters of a climb you're on (under CLIMB_RISE_M still to rise, then the road drops CLIMB_DROP_M below its
 * highest point): that point is the top (v0.76.1, DS v0.70.1; 2026-11-21 Watopia road 77 after the wooden bridge: "FEATHER in 80 …
 * 40", then 10 m below the top this read "no climb", gave the profile's end, and topUnseen held the feather unused).
 */
export function climbTopM(pts) {
    const p = (pts || []).filter(x => Number.isFinite(x.alt) && Number.isFinite(x.d));
    if (!p.length) {
        return 0;
    }
    let lo = Infinity;
    let top = null;
    let hi = null;   // the highest point so far, before any CLIMB_RISE_M rise
    for (const x of p) {
        if (!top) {
            lo = Math.min(lo, x.alt);
            if (!hi || x.alt > hi.alt) hi = x;
            if (x.alt - lo >= CLIMB_RISE_M) {
                top = {alt: x.alt, d: x.d};
            } else if (hi !== p[0] && x.alt <= hi.alt - CLIMB_DROP_M) {
                return hi.d;   // you're climbing to it (not on a descent from where you are)
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
 * Can't see the top: the road ahead is known only to its last point (open: the road learned from the riders ahead
 * ends where they are; the map's road ends at a junction off a route), it is still climbing there, and no top comes
 * before it. Then the steepest part may be past the end (2026-11-04, Tour of Watopia stage 5: the riders' road ended
 * ~650 m up a 6.8 km climb; "fire" came three times on 4% under the 9.9% near the top). Not "the end is gentler, so
 * nothing steeper comes": that climb's map road meets a junction at 3.5% with the 9.9% ramp just past it.
 */
export function topUnseen(pts, open) {
    const p = (pts || []).filter(x => Number.isFinite(x.alt) && Number.isFinite(x.d));
    if (!open || p.length < 2) return false;
    return climbTopM(p) >= p.at(-1).d - 1;   // no top inside what we know
}

/*
 * held: availablePowerUp; profile: the road ahead [{d, alt, v}] (as far as it goes: the whole climb, ideally); v: m/s;
 * grade: your current grade (fraction); archM: meters to the next arch that gives a power-up (null: not known);
 * open: the road past the profile's end is unknown (topUnseen: no call while the climb runs on past it).
 */
export function featherCue({held, profile, v, grade = 0, archM = null, open = false}) {
    if (held !== 'LIGHTNESS') {
        return none;
    }
    // nothing past the next arch, near or far: the race card says use it before (Spiral Summit replay: from the 14.0 km
    // arch it counted down to a ramp past the 14.9 km arch)
    const arch = Number.isFinite(archM) && archM > 0 ? archM : Infinity;
    const s = steepestAhead(profile, {vNow: v, lookM: Math.min(FEATHER_LOOK_M, arch)});
    const limitM = Math.min(climbTopM(profile), arch);
    const far = steepestAhead(profile, {vNow: v, lookM: limitM});
    const known = (profile || []).at(-1)?.d ?? 0;
    if (topUnseen(profile, open) && !(arch <= known)) {
        return {state: 'wait', startM: null, grade: null, text: "Feather: keep it, the top isn't in sight yet"};
    }
    // a part FEATHER_BETTER steeper up the climb, or the best part in sight running into it (cut at the look's edge)
    if (far && far.startM > FEATHER_LOOK_M && far.grade >= FEATHER_MIN_GRADE &&
        (!s || far.grade >= s.grade + FEATHER_BETTER || s.endM >= far.startM)) {
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

/*
 * The feather cue held still (v0.70.1, see the top): featherCue's target kept where it is on the road (odoM = your
 * distance ridden, m), "fire" from FEATHER_FIRE_M before it to FEATHER_FIRE_AFTER_S into it, spent once passed unused.
 *   new FeatherPick().update(cue (featherCue), {odoM, v}) -> {state, startM, grade, text} (the cue's shape)
 */
export class FeatherPick {
    constructor() {
        this.reset();
    }

    reset() {
        this.target = null;   // {atM (odo), grade}
        this.spent = null;    // the grade of a target passed unused
    }

    update(cue, {odoM, v = 5} = {}) {
        if (!cue || !cue.state || !Number.isFinite(odoM)) {   // no climb (or not held): start over
            this.reset();
            return cue || none;
        }
        if (cue.state === 'wait') {
            this.target = null;
            return cue;
        }
        const atM = odoM + cue.startM;
        if (this.spent != null && cue.grade < this.spent + FEATHER_BETTER) {
            return none;
        }
        if (!this.target || cue.grade >= this.target.grade + FEATHER_BETTER) {
            this.target = {atM, grade: cue.grade};
            this.spent = null;
        }
        const toM = this.target.atM - odoM;
        if (toM < -FEATHER_FIRE_AFTER_S * Math.max(v, 2)) {
            this.spent = this.target.grade;
            this.target = null;
            return none;
        }
        const pct = (this.target.grade * 100).toFixed(1);
        if (toM <= FEATHER_FIRE_M) {
            return {state: 'fire', startM: Math.max(0, toM), grade: this.target.grade, text: `FIRE FEATHER NOW — steepest part (${pct}% for ~30 s)`};
        }
        return {state: 'ready', startM: toM, grade: this.target.grade,
                text: `Feather: fire in ${Math.round(toM)} m, at the steepest part (${pct}% for ~30 s)`};
    }
}

/*
 * The anvil (v0.77.0 / DS v0.72.0; the user, 2026-11-22: "Add the anvil power up to ds"). Measured in the 2026-11-22
 * race (docs/FINDINGS.md, research/2026-11-22 anvils.mjs, anvil-field.mjs): for 15 s on road dropping 1.5% or more, its
 * kilos (ZI's sliding scale, blocking.mjs anvilKg) act as a PUSH: you get the energy of those kilos dropping down the
 * hill (anvil kg × g × the meters dropped) without having to speed them up. So the best 15 s is where you drop the most
 * meters: steep AND fast (the caffecter anvil page's rule of thumb). Look ahead to the bottom of the descent you're on or
 * coming to (descentEndM), or the next arch that gives a power-up, whichever comes first; a 15 s that drops ANVIL_BETTER_M
 * more further down is worth keeping it for ('wait', no call, until it comes within ANVIL_LOOK_M).
 */
export const ANVIL_SEC = 15;
export const ANVIL_MIN_GRADE = 0.015;   // it does nothing on road dropping less than this
export const ANVIL_MIN_DROP_M = 5;      // a 15 s worth calling: at least this many meters of drop (~1.5 kJ for a 75 kg rider)
export const ANVIL_LOOK_M = 1000;       // the countdown starts when the best 15 s is this close
export const ANVIL_FAR_M = 6000;        // how far down a descent it looks for a better 15 s
export const ANVIL_BETTER_M = 2;        // a 15 s further down this many meters' drop better: keep it for that one
export const ANVIL_FIRE_M = 20;         // this close to the best 15 s = fire now
export const ANVIL_FIRE_AFTER_S = 3;    // AnvilPick: "fire" up to this far into it, then spent

/* Meters to the bottom of the descent you're on or coming to: climbTopM on the road upside down. */
export function descentEndM(pts) {
    return climbTopM((pts || []).map(x => ({...x, alt: Number.isFinite(x.alt) ? -x.alt : x.alt})));
}

/*
 * The 15 s ahead that drops the most, from the road profile [{d, alt, v}]: {startM, dropM, secs, endM} or null. Only road
 * dropping ANVIL_MIN_GRADE or more counts (the anvil is off elsewhere); time per step from the riders' speed there, else vNow.
 * It starts on road already dropping that much (2026-11-22 replay: the whole Jarvis descent fits in 15 s at its speed, every
 * start tied and the first won: "ANVIL now" on the -0.5% approach, 50 s early; the top of the drop is the moment).
 */
export function mostDropAhead(pts, {vNow = 10, lookM = ANVIL_LOOK_M, sec = ANVIL_SEC} = {}) {
    const p = (pts || []).filter(x => Number.isFinite(x.alt) && Number.isFinite(x.d));
    if (p.length < 3) {
        return null;
    }
    let best = null;
    for (let i = 0; i + 1 < p.length && p[i].d <= lookM; i++) {
        const d0 = p[i + 1].d - p[i].d;
        if (!(d0 > 0) || (p[i].alt - p[i + 1].alt) / d0 < ANVIL_MIN_GRADE) continue;
        let t = 0;
        let drop = 0;
        let j = i;
        for (; j + 1 < p.length && t < sec; j++) {
            const dd = p[j + 1].d - p[j].d;
            if (dd <= 0) {
                continue;
            }
            const vs = Math.max(2, ((p[j].v ?? vNow) + (p[j + 1].v ?? vNow)) / 2);
            const dt = Math.min(dd / vs, sec - t);   // the last step only as far as the 15 s reach
            const dh = p[j].alt - p[j + 1].alt;
            if (dh / dd >= ANVIL_MIN_GRADE) drop += dh * dt / (dd / vs);
            t += dt;
        }
        if (t >= sec * 0.66 && (!best || drop > best.dropM + 1e-6)) {   // a tie (an even slope): the first
            best = {startM: p[i].d, dropM: drop, secs: t, endM: p[Math.min(j, p.length - 1)].d};
        }
    }
    return best;
}

/*
 * held: availablePowerUp; profile: the road ahead [{d, alt, v}] (to the bottom of the descent, ideally); v: m/s;
 * archM: meters to the next arch that gives a power-up (null: not known); open: the road past the profile is unknown.
 */
export function anvilCue({held, profile, v, archM = null, open = false}) {
    if (held !== 'ANVIL') {
        return none;
    }
    const arch = Number.isFinite(archM) && archM > 0 ? archM : Infinity;
    const p = profile || [];
    const known = p.at(-1)?.d ?? 0;
    // fired before the next arch (ANVIL_FIRE_M short of it), so that arch gives you a new power-up
    const limitM = Math.min(descentEndM(p), arch - ANVIL_FIRE_M, ANVIL_FAR_M);
    const near = mostDropAhead(p, {vNow: v, lookM: Math.min(ANVIL_LOOK_M, limitM)});
    const far = mostDropAhead(p, {vNow: v, lookM: limitM});
    // the bottom out of sight (the road still dropping at its end, nothing known past it): keep it only while less than
    // ANVIL_LOOK_M of road is known. Not the feather's "wait for the top": off a route the map's road ends at the next
    // junction, mid-descent on Jarvis (2026-11-22 replay: "wait" all the way down every lap, where the user fired it right),
    // and a descent is short: waiting past the steep part throws the anvil away
    if (open && known < ANVIL_LOOK_M && p.length >= 2 && descentEndM(p) >= known - 1 && !(arch <= known) && far && far.dropM >= ANVIL_MIN_DROP_M) {
        return {state: 'wait', startM: null, dropM: null, text: "Anvil: keep it, the bottom isn't in sight yet"};
    }
    if (far && far.startM > ANVIL_LOOK_M && far.dropM >= ANVIL_MIN_DROP_M &&
        (!near || far.dropM >= near.dropM + ANVIL_BETTER_M || near.endM >= far.startM)) {
        return {state: 'wait', startM: far.startM, dropM: far.dropM,
                text: `Anvil: keep it for ${Math.round(far.dropM)} m of drop in ${Math.round(far.startM)} m`};
    }
    if (!near || near.dropM < ANVIL_MIN_DROP_M) {
        return none;
    }
    if (near.startM <= ANVIL_FIRE_M) {
        return {state: 'fire', startM: near.startM, dropM: near.dropM, text: `FIRE ANVIL NOW — ${Math.round(near.dropM)} m of drop in 15 s`};
    }
    return {state: 'ready', startM: near.startM, dropM: near.dropM,
            text: `Anvil: fire in ${Math.round(near.startM)} m, for ${Math.round(near.dropM)} m of drop in 15 s`};
}

/*
 * The anvil cue held still, like FeatherPick: the target kept where it is on the road (odoM = your distance ridden), "fire"
 * from ANVIL_FIRE_M before it to ANVIL_FIRE_AFTER_S into it. Passed unused, unlike the feather, the next drop still counts
 * (2026-11-22 replay: Jarvis comes in two drops, the first called, let go, and the second, where the user fired, got
 * nothing): a 15 s that starts past the passed one's (ANVIL_SEC at your speed) and drops ANVIL_AGAIN_SHARE of it is
 * called; inside that, only one ANVIL_BETTER_M better (the best 15 s sliding along an even descent: not fire, ready, fire).
 */
export const ANVIL_AGAIN_SHARE = 0.8;
export class AnvilPick {
    constructor() {
        this.reset();
    }

    reset() {
        this.target = null;   // {atM (odo), dropM}
        this.spent = null;    // a target passed unused: {dropM, untilM (odo): where a next one may start}
    }

    update(cue, {odoM, v = 10} = {}) {
        if (!cue || !cue.state || !Number.isFinite(odoM)) {
            this.reset();
            return cue || none;
        }
        if (cue.state === 'wait') {
            this.target = null;
            return cue;
        }
        if (this.spent) {
            const atM = odoM + cue.startM;
            const again = atM >= this.spent.untilM && cue.dropM >= ANVIL_AGAIN_SHARE * this.spent.dropM;
            if (!again && cue.dropM < this.spent.dropM + ANVIL_BETTER_M) return none;
        }
        if (!this.target || cue.dropM >= this.target.dropM + ANVIL_BETTER_M) {
            this.target = {atM: odoM + cue.startM, dropM: cue.dropM};
            this.spent = null;
        }
        const toM = this.target.atM - odoM;
        if (toM < -ANVIL_FIRE_AFTER_S * Math.max(v, 2)) {
            this.spent = {dropM: this.target.dropM, untilM: this.target.atM + ANVIL_SEC * Math.max(v, 2)};
            this.target = null;
            return none;
        }
        const dm = Math.round(this.target.dropM);
        if (toM <= ANVIL_FIRE_M) {
            return {state: 'fire', startM: Math.max(0, toM), dropM: this.target.dropM, text: `FIRE ANVIL NOW — ${dm} m of drop in 15 s`};
        }
        return {state: 'ready', startM: toM, dropM: this.target.dropM, text: `Anvil: fire in ${Math.round(toM)} m, for ${dm} m of drop in 15 s`};
    }
}
