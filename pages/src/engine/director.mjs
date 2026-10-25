/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The "director sportif": one line of race advice at a time, the most urgent first. Each job proposes a call
 * ({id, priority, state, text}); the Director shows the highest priority and keeps it up long enough to read.
 *
 * First job — move up before a climb. Innsbruck race 2026-09-29, every move of 3+ places by riders who reached
 * the foot in the lead bunch (all 46 racers, 3 climbs): energy per place KEPT at the foot was 291 J 2–3 min
 * out (two-thirds of those places were lost again), 54–68 J at 60–120 s, 38 J at 60–45 s, 73–85 J at 45–15 s and
 * 154 J in the last 15 s (the whole bunch surges). A place bought then costs about the same joules as climbing
 * harder for it (1 s further back at the foot = 1.6 s at the top; +0.1 W/kg on the climb buys ~1.7 s) but from
 * below threshold rather than out of the FRC. Moves along or just outside the edge cost ~20 J/m against ~80–110 J/m
 * through the middle. Riders who arrived early and eased to bunch power were recycled (Michael K 1st -> 39th).
 * Hence: get ready at 90 s, move at 60–45 s along the edge, then hold the spot at ~+20–30 W over bunch power.
 */

import {smoothedGrades, secsTo} from './pacing-cue.mjs';
import {gapBetween} from './wheels.mjs';
import {FrcBalance} from './frc-live.mjs';

// The foot is estimated a few seconds late (the grade is smoothed over 40 m; race replay: "59 s" when the real foot
// was 53–55 s away), so the windows are set ~5 s early on the estimate to land on 60–45 s real.
export const PREP_SEC = 95;
// How late the learned road's foot estimate is (the windows above already allow for it). A route's profile finds the
// real foot (Innsbruck 2026-09-29 with the route traced every 5 m: the foot where the grade reaches 4% and stays
// above 3%, at the meter), so with exactFoot the windows are judged on secs + this, i.e. on the real 60–45 s.
export const ESTIMATE_LATE_S = 5;
export const MOVE_SEC = [50, 65];
export const QUIET_SEC = 18;          // the last seconds belong to the climb cue
export const CLIMB_START = 0.04;      // a climb starts where the smoothed grade reaches this…
export const CLIMB_KEEP = 0.03;       // …and lasts while it stays above this
export const CLIMB_MIN_RISE_M = 12;
export const CLIMB_MIN_SEC = 25;
export const BUNCH_MIN = 6;           // positioning advice only in a real group
export const FRONT_SHARE = 0.25;      // in the first quarter of the group (at least 3 riders) = already well placed
export const HOLD_SHARE = 0.4;        // after moving up, a spot in the front 40% is worth holding
export const HOLD_W = '+20–30 W';

export const PRIORITY = {move: 80, hold: 60, prep: 40, late: 30};

const none = {id: 'moveUp', state: null, text: '', priority: 0};

/*
 * The next real climb in the road profile [{d, alt, v}] (d = meters ahead): {inM, secs, grade, lengthM, riseM},
 * or null. Not while you're already on it.
 */
export function nextClimb(pts, {vNow = 10, grade = 0} = {}) {
    const p = (pts || []).filter(x => Number.isFinite(x.alt) && Number.isFinite(x.d) && x.d > 0);
    if (p.length < 4) {
        return null;
    }
    const g = smoothedGrades(p);
    for (let i = 0; i < p.length; i++) {
        if (g[i] < CLIMB_START) continue;
        let j = i;
        while (j + 1 < p.length && g[j + 1] >= CLIMB_KEEP) {
            j++;
        }
        const riseM = p[j].alt - p[i].alt;
        const lengthM = p[j].d - p[i].d;
        const onIt = i === 0 && grade >= CLIMB_START;
        if (riseM >= CLIMB_MIN_RISE_M && secsTo(p, j, vNow) - secsTo(p, i, vNow) >= CLIMB_MIN_SEC) {
            return onIt ? null : {inM: p[i].d, secs: secsTo(p, i, vNow), grade: lengthM > 0 ? riseM / lengthM : g[i],
                                  lengthM, riseM};
        }
        i = j;
    }
    return null;
}

/*
 * Move-up call for the climb ahead (secs = to the foot). group: {size, ahead} (groupLayout). Remembers where you were when the
 * move window opened, so it can tell "you moved, now hold it" from "too late, stay in line".
 */
export class MoveUpCoach {
    constructor() {
        this.window = null;   // {aheadAtStart, moved, settled} while approaching one climb
    }

    /* exactFoot: the profile is the route's (the foot estimate isn't late): the windows shift by ESTIMATE_LATE_S. */
    update({profile, v, grade = 0, group, exactFoot = false}) {
        const c = nextClimb(profile, {vNow: v, grade});
        const w = c ? c.secs + (exactFoot ? ESTIMATE_LATE_S : 0) : null;   // judged against the windows
        if (!c || !group || group.size < BUNCH_MIN || w > PREP_SEC) {
            if (!c) this.window = null;
            return none;
        }
        const T = Math.round(c.secs);
        const climb = `${Math.round(c.lengthM / 10) * 10} m at ${(c.grade * 100).toFixed(0)}%`;
        const wellPlaced = group.ahead <= Math.max(3, Math.round(group.size * FRONT_SHARE));
        if (w > MOVE_SEC[1]) {
            this.window = null;
            return {id: 'moveUp', state: 'prep', priority: PRIORITY.prep, secs: c.secs,
                    text: wellPlaced ? `Climb in ${T} s (${climb}): good spot, stay near the front` :
                        `Climb in ${T} s (${climb}): move up at 60 s, along the edge`};
        }
        if (!this.window) {
            this.window = {aheadAtStart: group.ahead};
        }
        if (w >= MOVE_SEC[0]) {
            return wellPlaced ?
                {id: 'moveUp', state: 'hold', priority: PRIORITY.hold, secs: c.secs, text: `Climb in ${T} s: good spot, hold it (${HOLD_W})`} :
                {id: 'moveUp', state: 'move', priority: PRIORITY.move, secs: c.secs, text: `MOVE UP NOW along the edge — climb in ${T} s`};
        }
        if (w <= QUIET_SEC) {
            return none;
        }
        // Sticky: once you have gained 3 places (or were well placed when the window closed) it stays "hold", so a
        // rider's jitter of a place or two doesn't flip the call.
        // Moved = gained 3+ places AND now in the front part of the group: gaining 35th -> 32nd of 42 is not a spot
        // worth holding (race-radio replay, 2026-10-02), so that gets "stay in line", not "hold".
        if (this.window.aheadAtStart - group.ahead >= 3 && group.ahead <= Math.round(group.size * HOLD_SHARE)) this.window.moved = true;
        if (this.window.settled == null) this.window.settled = wellPlaced;
        return this.window.moved || this.window.settled ?
            {id: 'moveUp', state: 'hold', priority: PRIORITY.hold, secs: c.secs, text: `Hold your spot, ${HOLD_W} till the road kicks up (${T} s)`} :
            {id: 'moveUp', state: 'late', priority: PRIORITY.late, secs: c.secs, text: `Too late to fight for places — stay in line, climb it (${T} s)`};
    }
}

/*
 * Picks one call to show: the highest priority; a new call must be proposed for onSec before it shows, and a
 * shown call stays up holdSec after it stops being proposed, unless a higher-priority call replaces it.
 */
export class Director {
    constructor({onSec = 1, holdSec = 3} = {}) {
        this.onMs = onSec * 1000;
        this.holdMs = holdSec * 1000;
        this.shown = null;     // {id, state, text, priority, lastWt}
        this.pending = null;   // {key, sinceWt}
    }

    update(wt, calls) {
        const live = (calls || []).filter(c => c && c.state && c.text).sort((a, b) => b.priority - a.priority);
        const top = live[0] || null;
        if (top) {
            const key = `${top.id}|${top.state}`;
            const same = this.shown && `${this.shown.id}|${this.shown.state}` === key;
            if (same) {
                this.shown = {...top, lastWt: wt};
            } else {
                if (!this.pending || this.pending.key !== key) this.pending = {key, sinceWt: wt};
                const outranks = !this.shown || top.priority > this.shown.priority;
                if (wt - this.pending.sinceWt >= this.onMs || (outranks && this.onMs === 0)) {
                    this.shown = {...top, lastWt: wt};
                    this.pending = null;
                } else if (outranks && this.shown && wt - this.pending.sinceWt >= this.onMs / 2) {
                    this.shown = {...top, lastWt: wt};
                    this.pending = null;
                }
            }
        } else {
            this.pending = null;
        }
        if (this.shown && wt - this.shown.lastWt > this.holdMs) {
            this.shown = null;
        }
        return this.shown ? {id: this.shown.id, state: this.shown.state, text: this.shown.text} : {id: null, state: null, text: ''};
    }
}

/* ===================== waste nudges ===================== */

/*
 * Occasional nudges for habits that waste power, each backed by the pack data (see the local notes and the team
 * report): pushing into the wheel (Holding), moving up through the middle (80–113 J per meter gained vs ~20 at the
 * edge, Innsbruck), sitting on the front of a group (40–70 W of draft), and riding off a wheel in a SMALL group (10–50 W;
 * in a big bunch it barely matters). A nudge needs the habit to last (holdS), then that nudge rests for COOLDOWN_S and
 * all nudges for GAP_S. Quiet before a climb and in the finale, where the real calls take over.
 * v0.68.4 (DS 0.41.0): crowding the wheel (draft-live.mjs crowdingCue 'crowding': under 1 m at full draft, ~+5 W for the
 * same speed, 2026-09-27 pack data): "give room", from the Data Tap's on-screen cue.
 */
export const NUDGE = {
    wheel: {holdS: 30, priority: 20},
    middle: {holdS: 10, priority: 22},
    front: {holdS: 20, priority: 21},
    line: {holdS: 15, priority: 19},
    crowd: {holdS: 10, priority: 18},
};
export const NUDGE_COOLDOWN_S = 300;
export const NUDGE_GAP_S = 60;
export const NUDGE_SHOW_S = 8;
export const WHEEL_HOLD_W = 25;        // Holding above this while holding your place
export const DEEP_INSIDE_M = 1;        // more than this inside the outermost rider on your side
export const SMALL_GROUP = 16;
export const UNIT_PER_M = 113513;      // roadPosition units per meter (lateral)

/*
 * How far inside the bunch you ride: meters between you and the outermost rider on your side of the bunch, among
 * riders within ±15 m along the road (same road and direction). + = inside, − = outside; null = too few riders near.
 */
export function lateralDepth(entries, me) {
    const s = me && me.state;
    if (!s || !Number.isFinite(s.roadPosition) || !Number.isFinite(me.gapDistance)) return null;
    const lat = [];
    for (const o of entries || []) {
        const t = o.state;
        if (o === me || !t || t.roadId !== s.roadId || t.reverse !== s.reverse || !Number.isFinite(t.roadPosition)) continue;
        if (!Number.isFinite(o.gapDistance) || Math.abs(o.gapDistance - me.gapDistance) > 15) continue;
        const l = (t.roadPosition - s.roadPosition) / UNIT_PER_M;
        if (Math.abs(l) <= 6) lat.push(l);
    }
    if (lat.length < 4) return null;
    const centre = lat.reduce((a, b) => a + b, 0) / lat.length;
    const side = centre <= 0 ? 1 : -1;            // +1: you are on the + side of the bunch centre
    return Math.max(...lat.map(l => l * side));  // how far the outermost rider on your side is beyond you
}

export class NudgeCoach {
    constructor() {
        this.since = {};      // kind -> wt the habit started
        this.lastAt = {};     // kind -> wt it was last shown
        this.lastAny = -Infinity;
        this.showing = null;  // {until, call}
    }

    /*
     * x: {wt (ms), size, ahead, holdW, relMs (you − group speed), depthM, q (draft / your max), gapAhead (m),
     *     positionW, crowding (crowdingCue says 'crowding'), quiet (climb or finale coming)}
     */
    update(x) {
        const wt = x.wt;
        if (this.showing && wt <= this.showing.until) return this.showing.call;
        this.showing = null;
        const inGroup = x.size >= 2;
        const moving = x.relMs > 0.14;
        const holding = Math.abs(x.relMs) <= 0.14;
        const now = {
            wheel: inGroup && holding && x.holdW > WHEEL_HOLD_W,
            middle: inGroup && x.size >= 6 && moving && x.depthM != null && x.depthM > DEEP_INSIDE_M,
            front: x.size >= 6 && x.ahead === 0,
            line: inGroup && x.size < SMALL_GROUP && x.ahead > 0 && x.gapAhead != null && x.gapAhead < 4 && x.q != null && x.q < 0.8,
            crowd: inGroup && !!x.crowding,
        };
        for (const k of Object.keys(now)) {
            if (!now[k]) delete this.since[k];
            else if (this.since[k] == null) this.since[k] = wt;
        }
        if (x.quiet || wt - this.lastAny < NUDGE_GAP_S * 1000) return none;
        const due = Object.keys(now).filter(k => now[k] && wt - this.since[k] >= NUDGE[k].holdS * 1000 &&
            !(wt - (this.lastAt[k] ?? -Infinity) < NUDGE_COOLDOWN_S * 1000)).sort((a, b) => NUDGE[b].priority - NUDGE[a].priority);
        if (!due.length) return none;
        const k = due[0];
        const w = v => (Number.isFinite(v) && v >= 5 ? ` (~${Math.round(v / 5) * 5} W)` : '');
        const text = {
            wheel: `Easy, you are pushing into the wheel${w(x.holdW)} for nothing`,
            middle: 'Moving up through the middle costs 4x: go round the edge',
            front: `Front of the group: sit in${w(x.positionW)}`,
            line: 'Small group: line up right behind a wheel',
            crowd: 'Crowding the wheel: under a meter costs ~5 W for the same speed, 2–3 m keeps the full draft',
        }[k];
        const call = {id: 'nudge', state: k, priority: NUDGE[k].priority, text};
        this.lastAt[k] = wt;
        this.lastAny = wt;
        this.showing = {until: wt + NUDGE_SHOW_S * 1000, call};
        return call;
    }
}

/* ===================== the sprint ===================== */

/*
 * Finish calls for distance events (Sauce's remaining / remainingMetric). Evidence (Innsbruck 2026-09-29): Mark went
 * 15th -> 3rd from 1 km out along the wheels, Nicholas was stuck 16th at 1 km; AERO best fired 22–28 s from the line;
 * the draft boost fired at the launch was the best power-up of all in a re-ride of that finish. Power-up rules from
 * Zwift Insider's guide (2026-09-16): ghost invisible 15 s and disabled within 400 m of the finish; van 40 s; burrito
 * 20 s; feather −10% weight 30 s. Timing rule (the user): fire at the last useful moment — for the van and burrito
 * when what is left of the race equals their duration, for the ghost just before 400 m — or on your jump, whichever
 * comes first. AERO too (15 s): the re-rides' 22–28 s best was where those sprints launched; if nobody has gone
 * yet (a wrecked bunch can start late) 25 s out is wasted, so it is your jump or 15 s to go. Your jump is detected from your power (>= 1.4× your 30 s average and
 * +150 W, 2 s) inside 1.5 km. ADVICE ONLY, by design: Zwift requires power-ups to be activated manually, and the mod
 * keeps to the spirit of that — it never fires one for the rider, not even from a button pressed earlier (the user,
 * 2026-10-02), although Sauce could (rpc.powerup).
 */
export const SPRINT_POSITION_M = [1300, 1700];
export const WINDUP_M = 1000;
export const GHOST_LAST_M = [400, 470];
export const AERO_S = 15;
export const VAN_S = 40;
export const BURRITO_S = 20;
export const JUMP_RATIO = 1.4;
export const JUMP_PLUS_W = 150;
// ...and this × FTP when known (2026-10-25: a surge to 440–474 W on the rise 650 m out read as the jump, and the window,
// "you can go", never came; the jump itself was 580 W, then 940)
export const JUMP_FTP = 2.2;
export const SPRINT_PRIORITY = {fire: 95, closer: 94, keep: 93, ease: 92, easeFtp: 91, windup: 90, take: 89, last: 88, window: 87, windowPrep: 86, position: 85, shake: 80, prep: 70,
                                good: 55};

/*
 * A rider closing fast from behind in the finish (the user, 2026-10-16: "due to being lazy and not wanting to really
 * empty the tank, I get caught by one or two riders that close at a big speed delta; they blow past me and I never
 * catch their wheel"). Warn while there's still time to dig in: once they're alongside 5+ km/h faster the wheel is
 * gone. Innsbruck 2026-09-29, 22 m to go, you at 84 W: two riders 11–14 m back at +9 and +13 km/h, 4–4.5 s from you
 * (research/2026-10-16/finish-closers.mjs). In the last CLOSER_M, or after your jump.
 */
export const CLOSER = {kmh: 4, secs: 6, maxM: 40, finishM: 600};

/* The rider behind you closing fastest, if one reaches you within CLOSER.secs at CLOSER.kmh+: {gapM, closeKmh, eta}. */
export function fastCloser(entries, me) {
    const s = me && me.state;
    if (!s) return null;
    let best = null;
    for (const o of entries || []) {
        const t = o.state;
        if (o === me || !t || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse) continue;
        const g = gapBetween(me, o).gap;   // + = ahead of you
        if (!Number.isFinite(g) || g >= -0.5 || g < -CLOSER.maxM) continue;
        const close = (t.speed || 0) - (s.speed || 0);
        if (close < CLOSER.kmh) continue;
        const eta = -g / (close / 3.6);
        if (eta <= CLOSER.secs && (!best || eta < best.eta)) best = {gapM: -g, closeKmh: close, eta};
    }
    return best;
}

/*
 * The sprint is decided (the user, 2026-10-18: "at some point in a sprint there comes a time when the results are not
 * going to change. No need to tell me to dig harder after that. Might not matter at the end of a race, but an
 * intermediate sprint it would matter a lot"). Settled = nobody behind can reach you by the line even if you stop
 * pedaling (you slow by SETTLED.coastMs2) and they find SETTLED.kickKmh more than now, and you can't reach the rider
 * ahead with SETTLED.kickKmh more yourself. 2026-10-18 group ride: clear at 159 m, a rider 11 m back at −9 km/h and
 * "keep going" from 97 m to the line; settled from 144 m.
 */
export const SETTLED = {kickKmh: 5, coastMs2: 0.35, minGapM: 3, rangeM: 80};

/*
 * true when no place within SETTLED.rangeM can change before the line, toLineM away. Options (the ease-to-FTP tier):
 * decelMs2 = how fast you slow (default: coasting, SETTLED.coastMs2), kickKmh = what a rider behind finds, a number or
 * a function of the seconds to the line (default SETTLED.kickKmh). Your own reach to a rider ahead keeps kickKmh 5.
 */
export function sprintSettled(entries, me, toLineM, {decelMs2 = SETTLED.coastMs2, kickKmh = SETTLED.kickKmh} = {}) {
    const s = me && me.state;
    if (!s || !(toLineM > 0)) return false;
    const T = toLineM / Math.max((s.speed || 0) / 3.6, 4);
    const kick = (typeof kickKmh === 'function' ? kickKmh(T) : kickKmh) / 3.6;
    const myKick = SETTLED.kickKmh / 3.6;
    for (const o of entries || []) {
        const t = o.state;
        if (o === me || !t || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse) continue;
        const g = gapBetween(me, o).gap;   // + = ahead of you
        if (!Number.isFinite(g) || Math.abs(g) > SETTLED.rangeM) continue;
        const close = ((t.speed || 0) - (s.speed || 0)) / 3.6;   // m/s, + = they are faster
        if (g <= 0) {
            const reach = (close + kick) * T + 0.5 * decelMs2 * T * T;
            if (-g < Math.max(SETTLED.minGapM, reach)) return false;
        } else if ((myKick - close) * T >= g) {
            return false;
        }
    }
    return true;
}

/*
 * Ease to FTP (the user, 2026-10-19: "build the ease to FTP tier for intermediate sprints"). Settled while you ride FTP
 * instead of coasting: you slow by what FTP leaves short of your air + rolling drag (decelAt, your CdA and mass), and a
 * rider behind finds what riders really found to the line in 1,086 finish samples (research/2026-10-19/chaser-kick.mjs,
 * p95 of their mean speed to the line − speed now): 2.5–2.7 km/h with 4–10 s to go, 4.2 at 10–14 s, 5.8 at 14–20 s.
 * Riders already sprinting (2×+ FTP) found the MOST (p95 4–8 km/h), so their power can't loosen it. FTP_KICK: 3 km/h
 * inside FTP_KICK.nearS, else SETTLED.kickKmh.
 */
export const FTP_KICK = {nearKmh: 3, nearS: 10};
export const ftpKick = T => (T <= FTP_KICK.nearS ? FTP_KICK.nearKmh : SETTLED.kickKmh);

/* m/s² you slow by at power W, speed v m/s (flat): (air + rolling − power) / v / mass; 0 if the power holds it. */
export function decelAt(powerW, v, {cda, crr, massKg}) {
    if (!(v > 1) || !(cda > 0) || !(massKg > 0)) return SETTLED.coastMs2;
    const needW = 0.5 * 1.225 * cda * v ** 3 + (crr || 0.004) * massKg * 9.80665 * v;
    return Math.max(0, (needW - (powerW || 0)) / v / massKg);
}

/*
 * Two finish calls from the user's race finishes (research/2026-10-11/sprint-finish.mjs; docs/FINDINGS.md "THE TWO RACE
 * FINISHES"). KEEP GOING: on 2026-09-29 the power fell 444 -> ~90 W at 83 m to go, 1st at 40 m, 2nd at the line (that
 * one was a gift to the lead-out teammate, the user says — so it is a reminder, never more): after your jump, inside
 * KEEP_GOING_M, power under KEEP_GOING_RATIO of your sprint's peak. LAST WHEEL: on 2026-10-06 the user launched from
 * the last wheel of five, together with the others, and for 15 s closed at only +1.3–2.6 km/h — the band where passes
 * get held (research/2026-10-11/field-trigger.mjs) — and got through between two riders only at the line, by half a
 * wheel: in a small group inside the last kilometer, last wheel before anyone has gone -> go first, from 3–5 m back
 * up the edge, and you don't need the line to come to you. Up the edge, not wide (the user, 2026-10-23: "I want to
 * sprint up the edge"): with 5+ km/h the sideways gap hardly matters (pass-geometry.mjs), and the edge keeps the draft.
 */
/*
 * When to go and how hard (the user, 2026-10-18: "if it is a long ways out I just want to get on the wheel until it
 * burns out. Then jump around, or pick up the next wheel coming from behind"; plan the sprint to take the tank down to
 * ~3 kJ, since FRC isn't all that goes into a sprint at the end of a race). In 5 recorded finishes the FRC used from
 * the jump to the line was 7.9–9.1 kJ whatever the distance, so the power held ≈ FTP + budget / seconds to go
 * (research/2026-10-18/sprint-jumps.mjs). TARGET = FTP + (FRC left − SPRINT_RESERVE_J) / seconds to the line at your
 * sprint speed (your speed + SPRINT_GAIN_KMH: 39 -> 49–58 km/h peak in those finishes). The WINDOW opens when that
 * target reaches SPRINT_RATIO × FTP (the 23 s sprints held 589–614 W at FTP 234: 2.5×): from there you can go to the
 * line. Before it, a rider coming past fast is a wheel to take, not one to hold off ("take the wheel", not "dig in").
 */
export const SPRINT_RESERVE_J = 3000;
export const SPRINT_GAIN_KMH = 8;
export const SPRINT_RATIO = 2.5;
/*
 * The wheels worth taking (research/2026-10-18/sprint-pacing.mjs, from 39 km/h, flat out onto the wheel): +5 km/h is on
 * in ~2 s, +8 in ~8 s, +13 never with 3 kJ kept (18 s flat out). The user, 2026-10-18: limit "take the wheel" to 4–8.
 */
export const TAKE_WHEEL_KMH = 8;
/*
 * ...and only in the finish (the user, 2026-10-19: v0.25 called it 14 times from 19 km to 2 km out, a free ride
 * included: "way too often"). 1 km = LAST_WHEEL_M's far end, where the finish calls start.
 */
export const TAKE_WHEEL_M = 1000;
/*
 * How hard, and when (the user, 2026-10-19: "take the wheel" is "verbose and in the heat of a sprint not all that
 * useful. Maybe 'wheel, jump hard', 'wheel, jump medium', 'wheel, jump light'. There is a timing to get right so I
 * don't jump too soon"). The effort from how much faster they come: up to WHEEL_JUMP.lightKmh light (2× FTP), up to
 * mediumKmh medium (3×), faster hard (WHEEL_JUMP.hardX × FTP, ~1,000 W at FTP 234); one step harder while that
 * effort takes over maxAccelS to reach their speed (light at 44 km/h in the wind never gets there). The moment: you
 * jump at that power (flat road, your CdA and mass, in the wind: a little early if you're sheltered) and match their
 * speed as they come by, onWheelM behind them; the call comes reactS earlier (the words + your reaction): 2.5–7 m
 * behind you, 2–4 s before they're level. Before that moment: no call (too soon = you go first and tow them).
 */
export const WHEEL_JUMP = {lightKmh: 5, mediumKmh: 6.5, lightX: 2, mediumX: 3, hardX: 4.3, maxAccelS: 5, onWheelM: 1.5, reactS: 1.5,
                           holdS: 5};   // the effort called holds this long (2026-10-15 replay: medium, hard, medium in 5 s)
const EFFORTS = ['light', 'medium', 'hard'];

/* closer {gapM, closeKmh}, v m/s, ftpW, model {cda, crr, massKg} -> {effort, powerW, jumpAtM (gap to call at), now} */
export function wheelJump(closer, v, ftpW, model) {
    if (!closer || !(ftpW > 0) || !model || !(model.cda > 0)) return null;
    const dKmh = closer.closeKmh;
    const vT = v + dKmh / 3.6, m = model.massKg + 7, c = (model.crr || 0.004) * m * 9.80665;
    // their gain on you while you get up to their speed at powerW, and how long it takes (Infinity: never)
    const accel = powerW => {
        let u = v, gain = 0, t = 0;
        while (u < vT && t <= WHEEL_JUMP.maxAccelS * 3) {
            const a = (powerW / Math.max(u, 1) - 0.5 * 1.225 * model.cda * u * u - c) / m;
            if (a <= 0.01) return {gain, t: Infinity};
            u = Math.min(vT, u + a * 0.1);
            gain += (vT - u) * 0.1;
            t += 0.1;
        }
        return {gain, t: u < vT ? Infinity : t};
    };
    let i = dKmh <= WHEEL_JUMP.lightKmh ? 0 : dKmh <= WHEEL_JUMP.mediumKmh ? 1 : 2;
    let r = accel(ftpW * WHEEL_JUMP[`${EFFORTS[i]}X`]);
    while (r.t > WHEEL_JUMP.maxAccelS && i < 2) r = accel(ftpW * WHEEL_JUMP[`${EFFORTS[++i]}X`]);
    const effort = EFFORTS[i], powerW = ftpW * WHEEL_JUMP[`${effort}X`];
    if (!Number.isFinite(r.t)) return {effort, powerW, jumpAtM: null, now: false};   // not even flat out: no wheel to take
    const jumpAtM = Math.max(0, r.gain - WHEEL_JUMP.onWheelM) + (dKmh / 3.6) * WHEEL_JUMP.reactS;
    return {effort, powerW, jumpAtM, now: closer.gapM <= jumpAtM};
}

/* {targetW, open} from your FRC left, or null without FTP / FRC. remainingM to the line, v m/s. */
export function sprintBudget({leftJ, ftpW, remainingM, v}) {
    if (!(ftpW > 0) || !Number.isFinite(leftJ) || !(remainingM > 0)) return null;
    const secs = remainingM / Math.max((v || 0) + SPRINT_GAIN_KMH / 3.6, 4);
    const targetW = ftpW + Math.max(0, leftJ - SPRINT_RESERVE_J) / secs;
    return {targetW, secs, open: targetW >= SPRINT_RATIO * ftpW};
}

/*
 * Where the window will open (m before the line) at today's FRC: the distance whose target is SPRINT_RATIO × FTP.
 * The countdown to it (v0.68.6; the user, 2026-10-25: "at the finish of the event it didn't call the sprint": from
 * "top ten" 1.3 km out to the window at 360 m nothing spoke) is "jump in N", WINDOW_PREP_S out at most.
 */
export const WINDOW_PREP_S = 45;
export function sprintWindowM({leftJ, ftpW, v}) {
    if (!(ftpW > 0) || !Number.isFinite(leftJ)) return null;
    const secs = Math.max(0, leftJ - SPRINT_RESERVE_J) / ((SPRINT_RATIO - 1) * ftpW);
    return secs * Math.max((v || 0) + SPRINT_GAIN_KMH / 3.6, 4);
}

export const KEEP_GOING_M = 200;
export const KEEP_GOING_RATIO = 0.5;
// ...and under this × FTP (when known): 2026-10-19, 180 m out, 504 W was "under half" of a 1015 W AERO peak, and not easing off
export const KEEP_GOING_FTP = 1.5;
export const LAST_WHEEL_GROUP = [3, 8];   // group sizes where being last wheel decides the sprint
export const LAST_WHEEL_M = [200, 1000];  // ...from 1 km out until the line is too close to matter
// ...in seconds along the road ahead when the route is known (2026-10-23 group ride: 1000 m with a 5% climb in it was
// 119 s, and "go first" sounded like "go now"): 80 s ≈ 1 km at 45 km/h, 15 s ≈ 200 m at 50
export const LAST_WHEEL_S = [15, 80];

/*
 * Shaking a wheel in the sprint (the user, 2026-10-03). When the front rider drifts sideways the riders behind follow
 * late: on straight road the rider directly behind kept only 29–81% of their usual draft, the third 54–95%, from the
 * fourth back no change (research/2026-10-03/leader-drift.mjs; race + 2 pacer rides; small samples, and some
 * "drifts" were riders pulling off). So when you are in the wind in the finale with someone on your wheel, a slow
 * drift to one side makes them work. Only offered when your setup can steer (state.canSteer) and there is room on
 * that side. With steering enabled it's fair game (the user: no race organizer calls out riders for it); the effect
 * measured came from slow drifts, so the call says "drift".
 * Side: +roadPosition is the rider's RIGHT on roads ridden forward and LEFT in reverse (latlng check, 2 worlds,
 * > 600,000 side-by-side pairs; research/2026-10-03/lateral-side.mjs).
 * Only a FOLLOWER counts: a rider behind you at about your speed (closing ≤ maxCloseKmh). A faster rider 1–2 m back is
 * passing, not sitting on (group ride 2026-10-16, top of the last climb: "drift right" for a rider closing at
 * 14 vs 6 km/h, who went by 3 s later). And only at minKmh+: below that the draft is worth too little to take away.
 */
export const SHAKE = {behindM: 2.5, behindLatM: 0.5, exposedM: 5, wheelLatM: 0.8, lookM: 4, roomM: 1.0, windQ: 0.5,
                      maxCloseKmh: 2.5, minKmh: 25, openM: 3};

/* Who is on your wheel, whether you are in the wind, and the room on each side (m) — for the sprint's wheel shake. */
export function sprintWheels(entries, me) {
    const s = me && me.state;
    if (!s || !Number.isFinite(s.roadPosition)) return null;
    const rightSign = s.reverse ? -1 : 1;
    let behind = null, exposed = true;
    const nearest = {left: Infinity, right: Infinity};
    for (const o of entries || []) {
        const t = o.state;
        if (o === me || !t || t.roadId !== s.roadId || t.reverse !== s.reverse || !Number.isFinite(t.roadPosition)) continue;
        const along = gapBetween(me, o).gap;                 // + = o is ahead of you
        if (!Number.isFinite(along)) continue;
        const lat = (t.roadPosition - s.roadPosition) / UNIT_PER_M * rightSign;   // + = on your right
        if (along > 0 && along < SHAKE.exposedM && Math.abs(lat) < SHAKE.wheelLatM) exposed = false;
        if (along < 0 && along > -SHAKE.behindM && Math.abs(lat) < SHAKE.behindLatM && (!behind || -along < behind.gapM)) {
            behind = {id: o.athleteId, gapM: -along, latM: lat,
                      closeKmh: Number.isFinite(t.speed) && Number.isFinite(s.speed) ? t.speed - s.speed : null};
        }
        if (Math.abs(along) < SHAKE.lookM && Math.abs(lat) >= SHAKE.wheelLatM * 0.5) {
            const side = lat > 0 ? 'right' : 'left';
            nearest[side] = Math.min(nearest[side], Math.abs(lat));
        }
    }
    return {behind, exposed, room: {left: nearest.left, right: nearest.right}, vKmh: s.speed};
}

/*
 * The side to drift to, or null. "In the wind" = no wheel in line within 5 m AND (when known) your draft share q
 * below half of your maximum: the Innsbruck replay had 45–146 W of draft with no in-line wheel (riders just off your
 * line or further ahead still shelter you). Null when boxed in. More room wins; ties go away from the follower.
 */
export function shakeSide(w, q = null) {
    if (!w || !w.behind || !w.exposed) return null;
    if (w.behind.closeKmh != null && w.behind.closeKmh > SHAKE.maxCloseKmh) return null;   // passing, not following
    if (Number.isFinite(w.vKmh) && w.vKmh < SHAKE.minKmh) return null;                    // too slow for draft to matter
    if (Number.isFinite(q) && q >= SHAKE.windQ) return null;
    // open road on a side = OPEN_M: two open sides are a tie (Infinity − Infinity is NaN, so a ride with nobody near
    // always drifted right; group ride 2026-10-16: the follower was on your right, the call said "drift right")
    const left = Math.min(w.room.left, SHAKE.openM), right = Math.min(w.room.right, SHAKE.openM);
    if (Math.max(left, right) < SHAKE.roomM + 0.6) return null;
    if (Math.abs(left - right) < 0.3) return w.behind.latM > 0 ? 'left' : 'right';
    return left > right ? 'left' : 'right';
}

/*
 * After your jump, once no place can change (the user, 2026-10-19: "didn't tell me that I could ease off when I
 * could"; then "build the ease to FTP tier for intermediate sprints"): settled even if you coast (sprintSettled) ->
 * "ease off"; settled while you ride FTP (sprintSettled with decelAt(FTP) and ftpKick, usually earlier) -> "ease to
 * FTP". Only while you push above them (EASE_FTP_OVER × FTP for the FTP tier), and with EASE_MIN_S+ to the line
 * (Urumaze 2026-10-06 replay: "ease off" 13 m before the Tower sprint line, too late to matter).
 */
export const EASE_FTP_OVER = 1.15;
export const EASE_MIN_S = 3;
export function easeCall({jumped, power = 0, ftpW, peak = 0, settled, settledFtp, secsToLine = Infinity, where = 'Your place'}) {
    if (!jumped || !(secsToLine >= EASE_MIN_S)) return null;
    if (settled && power > (ftpW > 0 ? 0.9 * ftpW : KEEP_GOING_RATIO * peak)) {
        return {id: 'sprint', state: 'ease', priority: SPRINT_PRIORITY.ease, text: `${where} is safe: ease off`};
    }
    if (settledFtp && ftpW > 0 && power > EASE_FTP_OVER * ftpW) {
        return {id: 'sprint', state: 'ease-ftp', priority: SPRINT_PRIORITY.easeFtp,
                text: `${where} is safe at FTP: ease to ${Math.round(ftpW / 10) * 10} W`};
    }
    return null;
}

/*
 * The same two calls at an intermediate sprint (a contested scored sprint on the race card: race-card.mjs
 * sprintLineAhead). Your jump as SprintCoach finds it, inside INTERMEDIATE_M of the line; reset past the line.
 */
export const INTERMEDIATE_M = 1000;
export class IntermediateCoach {
    constructor() {
        this.avgP = null;
        this.lastWt = null;
        this.jumpTicks = 0;
        this.jumped = false;
        this.peak = 0;
        this.lineKey = null;
    }

    /* x: {wt, toLineM (null: no line ahead), lineKey, v (m/s), power, ftpW, settled, settledFtp} -> a call or none */
    update(x) {
        const {wt, toLineM, power = 0} = x;
        const dt = this.lastWt != null && wt > this.lastWt ? Math.min(3, (wt - this.lastWt) / 1000) : 0;
        if (wt != null) this.lastWt = wt;
        if (this.avgP == null) this.avgP = power;
        else if (dt > 0 && !this.jumpTicks && !this.jumped) this.avgP += (1 - Math.exp(-dt / 30)) * (power - this.avgP);
        if (!(toLineM > 0) || toLineM > INTERMEDIATE_M || x.lineKey !== this.lineKey) {
            this.lineKey = toLineM > 0 && toLineM <= INTERMEDIATE_M ? x.lineKey : null;
            this.jumped = false;
            this.jumpTicks = 0;
            this.peak = 0;
            if (!this.lineKey) return none;
        }
        if (!this.jumped) {
            const floor = x.ftpW > 0 ? JUMP_FTP * x.ftpW : 0;
            this.jumpTicks = power >= Math.max(this.avgP * JUMP_RATIO, this.avgP + JUMP_PLUS_W, floor) ? this.jumpTicks + 1 : 0;
            if (this.jumpTicks >= 2) this.jumped = true;
        }
        if (this.jumped) this.peak = Math.max(this.peak, power);
        return easeCall({jumped: this.jumped, power, ftpW: x.ftpW, peak: this.peak, settled: x.settled, settledFtp: x.settledFtp,
                         secsToLine: toLineM / Math.max(x.v || 0, 4), where: 'The sprint'}) || none;
    }
}

export class SprintCoach {
    constructor() {
        this.avgP = null;
        this.lastWt = null;
        this.jumpTicks = 0;
        this.jumped = false;
        this.vg = [];          // [{wt, v}] group speed over the last few seconds
        this.peak = 0;         // your sprint's peak power since the jump
        this.budget = null;    // sprintBudget: {targetW, secs, open} this tick
        this.wheelCall = null; // the last "wheel, jump …": {wt, call} (held WHEEL_JUMP.holdS)
    }

    reset() {
        this.jumped = false;
        this.jumpTicks = 0;
        this.peak = 0;
    }

    /* x: {wt, remaining, remainingMetric, remainingType, v, power, held, bike, toLineS (seconds along the road ahead),
     *     group: {size, ahead, vGroup}, wheels (sprintWheels), canSteer, q,
     *     closer (fastCloser), frc ({leftJ}, your FRC balance) + ftpW (for sprintBudget), model ({cda, crr, massKg}: wheelJump), settled (sprintSettled: no place can change, so no "dig in" / "keep going")}
     * Events only: Sauce's remaining is also the end of your route in a free ride ('route'), and after a group ride on
     * the same course the finish calls came round again (2026-10-23). On a TT bike no power-up calls: TT bikes lose the
     * power-up at the next arch while Sauce still shows the one picked up ("use AERO", with no AERO, the same ride). */
    update(x) {
        const {wt, remaining, v, power = 0} = x;
        const held = x.bike === 'tt' ? null : x.held;
        const dt = this.lastWt != null && wt > this.lastWt ? Math.min(3, (wt - this.lastWt) / 1000) : 0;
        if (wt != null) this.lastWt = wt;
        if (this.avgP == null) this.avgP = power;
        else if (dt > 0 && !this.jumpTicks) this.avgP += (1 - Math.exp(-dt / 30)) * (power - this.avgP);
        if (x.remainingMetric !== 'distance' || (x.remainingType != null && x.remainingType !== 'event') || !(remaining > 0)) {
            this.reset();
            return none;
        }
        if (remaining > SPRINT_POSITION_M[1] + 500) this.reset();
        const g = x.group || {size: 1, ahead: 0};
        if (remaining <= 1500 && !this.jumped) {
            const floor = x.ftpW > 0 ? JUMP_FTP * x.ftpW : 0;
            this.jumpTicks = power >= Math.max(this.avgP * JUMP_RATIO, this.avgP + JUMP_PLUS_W, floor) ? this.jumpTicks + 1 : 0;
            if (this.jumpTicks >= 2) this.jumped = true;
        }
        if (this.jumped) this.peak = Math.max(this.peak, power);
        if (Number.isFinite(g.vGroup)) {
            this.vg.push({wt, v: g.vGroup});
            while (this.vg.length && this.vg[0].wt < wt - 3500) this.vg.shift();
        }
        const windup = !this.jumped && remaining <= WINDUP_M && this.vg.length > 2 && g.size >= 4 &&
            this.vg.at(-1).v - this.vg[0].v >= 0.75;
        const toLine = remaining / Math.max(v || 0, 4);
        const fire = name => ({id: 'sprint', state: `fire-${name}`, priority: SPRINT_PRIORITY.fire, text: `${name} NOW`});
        const prep = text => ({id: 'sprint', state: 'prep', priority: SPRINT_PRIORITY.prep, text});
        const left = s => Math.max(0, Math.round(toLine - s));
        let pu = none;
        if (held === 'AERO') {
            if ((this.jumped && toLine <= 45) || (toLine <= AERO_S && toLine >= 3)) pu = fire('AERO');
            else if (toLine <= 60) pu = prep('Holding AERO: fire it when you jump (or at 15 s to go)');
        } else if (held === 'DRAFTBOOST') {
            if ((toLine <= VAN_S || this.jumped) && g.size >= 2) pu = fire('VAN');
            else if (toLine <= VAN_S + 30) pu = prep(`Holding the van: fire at 40 s to go (in ${left(VAN_S)} s) or when you jump, on a wheel`);
        } else if (held === 'NINJA') {
            if (remaining > GHOST_LAST_M[0] && (remaining <= GHOST_LAST_M[1] || this.jumped)) pu = fire('GHOST');
            else if (remaining > GHOST_LAST_M[0] && remaining <= 1200) pu = prep('Holding the ghost: fire just before 400 m to go, or on your jump');
        } else if (held === 'UNDRAFTABLE') {
            if ((toLine <= BURRITO_S || this.jumped) && g.ahead === 0) pu = fire('BURRITO');
            else if (toLine <= BURRITO_S + 30) pu = prep('Holding the burrito: fire it from the front, at 20 s to go or on your jump');
        } else if (held === 'BOOST') {
            if (this.jumped) pu = fire('ARROWS');
            else if (remaining <= 1200) pu = prep('Holding the arrows: fire them on your jump');
        } else if (held === 'LIGHTNESS') {
            // On a flat finish the feather (−10% body weight, 30 s) only helps the acceleration: ~0.5 kJ less to bring
            // 78 kg from 42 to 57 km/h (Urumaze 2026-10-06), ~50 W over a 10 s wind-up, + ~4 W rolling; air drag
            // unchanged. Small, but at the finish there's nothing to keep it for (the user, 2026-10-16): on your jump.
            if (this.jumped) pu = fire('FEATHER');
            else if (remaining <= 1200) pu = prep('Holding the feather: fire it on your jump (it helps the acceleration)');
        }
        if (pu.state && pu.state.startsWith('fire')) return pu;
        const b = this.budget = x.frc ? sprintBudget({leftJ: x.frc.leftJ, ftpW: x.ftpW, remainingM: remaining, v}) : null;
        const hold = b ? `: hold ${Math.round(b.targetW / 10) * 10} W to the line` : '';
        // too far out to go to the line: a rider coming past up to TAKE_WHEEL_KMH faster is a wheel to take; a faster
        // one is gone (no call: chasing it would empty the tank)
        const wc = x.closer;
        const early = wc && !x.settled && !this.jumped && b && !b.open && remaining <= TAKE_WHEEL_M;
        if (early && wc.closeKmh <= TAKE_WHEEL_KMH) {
            const j = wheelJump(wc, v, x.ftpW, x.model);
            if (!j) {
                return {id: 'sprint', state: 'take-wheel', priority: SPRINT_PRIORITY.take, text: 'Wheel: jump'};
            }
            const held = this.wheelCall && wt - this.wheelCall.wt <= WHEEL_JUMP.holdS * 1000 ? this.wheelCall.call : null;
            if (held) return held;
            if (j.now) {
                const call = {id: 'sprint', state: `take-wheel-${j.effort}`, priority: SPRINT_PRIORITY.take, text: `Wheel, jump ${j.effort}`,
                              powerW: Math.round(j.powerW)};
                this.wheelCall = {wt, call};
                return call;
            }
        }
        // a rider closing fast from behind: dig in while you can still hold them off or take the wheel
        if (x.closer && !early && !x.settled && (remaining <= CLOSER.finishM || this.jumped)) {
            return {id: 'sprint', state: 'closer', priority: SPRINT_PRIORITY.closer,
                    text: `Rider coming fast behind (+${x.closer.closeKmh.toFixed(0)} km/h): dig in`};
        }
        // after your jump, no place can change any more: ease off / ease to FTP (easeCall)
        const ease = easeCall({jumped: this.jumped, power, ftpW: x.ftpW, peak: this.peak, settled: x.settled, settledFtp: x.settledFtp,
                               secsToLine: remaining / Math.max(v || 0, 4)});
        if (ease) return ease;
        // easing off before the line after your jump: a reminder (you may be giving it away on purpose)
        if (this.jumped && !x.settled && remaining <= KEEP_GOING_M && this.peak > 0 && power < KEEP_GOING_RATIO * this.peak &&
            !(x.ftpW > 0 && power >= KEEP_GOING_FTP * x.ftpW)) {
            return {id: 'sprint', state: 'keep-going', priority: SPRINT_PRIORITY.keep,
                    text: `${Math.round(remaining)} m to go — keep going to the line`};
        }
        // last wheel of a small group before the sprint: go first up the edge, or be held behind them
        const lastWheel = g.size >= LAST_WHEEL_GROUP[0] && g.size <= LAST_WHEEL_GROUP[1] && g.ahead === g.size - 1;
        const lastWindow = Number.isFinite(x.toLineS) ? x.toLineS >= LAST_WHEEL_S[0] && x.toLineS <= LAST_WHEEL_S[1] :
            remaining >= LAST_WHEEL_M[0] && remaining <= LAST_WHEEL_M[1];
        if (!this.jumped && lastWheel && lastWindow) {
            // "be ready", not "go": the go is "jump now" (they wind up) or "you can go" (the window). Not "go wide": that's
            // the passing cue's word, heard all the time and learned to ignore (the user, 2026-10-23)
            return windup ?
                {id: 'sprint', state: 'last-go', priority: SPRINT_PRIORITY.windup,
                 text: "They're going and you're last wheel: jump now, up the edge, 5+ km/h faster"} :
                {id: 'sprint', state: 'last', priority: SPRINT_PRIORITY.last,
                 text: `Last wheel of ${g.size}: be ready to go first — from 3–5 m back, up the edge — or you'll be held`};
        }
        if (!this.jumped && b && b.open) {
            return {id: 'sprint', state: 'window', priority: SPRINT_PRIORITY.window, text: `You can go from here${hold}`};
        }
        if (windup) return {id: 'sprint', state: 'windup', priority: SPRINT_PRIORITY.windup, text: 'They are going: get on a wheel'};
        // the window ahead: "jump in 20"
        const openM = !this.jumped && b && remaining <= WINDUP_M ? sprintWindowM({leftJ: x.frc.leftJ, ftpW: x.ftpW, v}) : null;
        // seconds along the road ahead when known (a rise before the line is slow: that ride's 28 km/h at 600 m)
        const inS = openM == null ? null : Number.isFinite(x.toLineS) && remaining > 0 ? x.toLineS * (remaining - openM) / remaining :
            (remaining - openM) / Math.max(v || 0, 4);
        if (inS > 0 && inS <= WINDOW_PREP_S) {
            return {id: 'sprint', state: 'window-prep', priority: SPRINT_PRIORITY.windowPrep, inS,
                    text: `You can go in ${Math.round(inS)} s (${Math.round(openM)} m out)`};
        }
        // in the wind with a rider on your wheel in the last kilometer: drift to make them work
        const side = x.canSteer && (remaining <= WINDUP_M || this.jumped) ? shakeSide(x.wheels, x.q) : null;
        if (side) {
            return {id: 'sprint', state: `shake-${side}`, priority: SPRINT_PRIORITY.shake,
                    text: `Rider on your wheel: drift ${side}, make them work`};
        }
        if (remaining >= SPRINT_POSITION_M[0] && remaining <= SPRINT_POSITION_M[1] && g.size >= 6) {
            return g.ahead >= 10 ?
                {id: 'sprint', state: 'position', priority: SPRINT_PRIORITY.position, text: 'Sprint in 1.5 km: get into the top 10, along the edge'} :
                {id: 'sprint', state: 'good', priority: SPRINT_PRIORITY.good, text: 'Sprint in 1.5 km: good spot, stay in the top 10'};
        }
        return pu;
    }
}

/*
 * Will the flyer stay away? (the user, 2026-10-18: "if we assumed some maximum average FRC, we should be able to
 * predict if the flyer is going to make it to the line"; research/2026-10-18/flyers.mjs.) Each rider of your event
 * gets an FRC balance from their power (their profile FTP, an assumed FRC: FLYER.frcKJ). In the last FLYER.fromM: the
 * nearest rider 10–400 m ahead of your group's front riding at FLYER.minFtp × their FTP or more over 10 s (2026-10-19: a
 * rider 16–34 m up at 60–70% of FTP fell back, while "alone" made them a flyer with a full tank). Their best case: they
 * spend the tank evenly to the line (at least their power now), the most they can push falling as it empties
 * (Morton), then FTP; drag and rolling fitted to their speed now. Your group holds its speed, then the last 400 m at
 * +SPRINT_GAIN_KMH. Innsbruck 2026-09-29 (a flyer ~5 s up from 2 km, caught at ~240 m): 20 kJ said "caught" from 1 km
 * on, speed alone said "away" to 500 m; 15 kJ right from 2 km, 25–40 kJ wrong. One flyer: shown, not spoken.
 * Others' power is used live only; nothing is kept.
 */
export const FLYER = {frcKJ: 20, fromM: 3000, minM: 10, maxM: 400, groupM: 6, minFtp: 0.9, crr: 0.004, bikeKg: 8, staleMs: 60_000};

/* Does a rider gM ahead of your group's front reach the line first? {away, caughtAtM (to the line; null if away)} */
export function flyerOutlook({dF, vF, pF, ftp, massKg, leftJ, frcJ}, vP, dP) {
    const G = 9.80665, DT = 0.25, c = FLYER.crr * massKg * G;
    const k = Math.max(0.05, (pF / Math.max(vF, 3) - c) / Math.max(vF, 3) ** 2);   // ½ρCdA(1 − draft) that fits now
    let xF = 0, xP = 0, v = vF, def = frcJ - leftJ, t = 0;
    while (xF < dF && t < 600) {
        if (dP - xP <= dF - xF) return {away: false, caughtAtM: Math.max(0, dF - xF)};
        const left = Math.max(0, frcJ - def);
        const cap = ftp + (Math.max(pF, 2.5 * ftp) - ftp) * left / frcJ;
        const want = Math.max(pF, ftp + left / Math.max(1, (dF - xF) / v));
        const p = left > 0 ? Math.min(want, cap) : Math.min(want, ftp);
        def = p > ftp ? def + (p - ftp) * DT : def * Math.exp(-(ftp - p) * DT / frcJ);
        v = Math.max(2, v + DT * (p / v - k * v * v - c) / massKg);
        xF += v * DT;
        xP += (dP - xP <= 400 ? vP + SPRINT_GAIN_KMH / 3.6 : vP) * DT;
        t += DT;
    }
    return {away: true, caughtAtM: null};
}

export class FlyerWatch {
    constructor() {
        this.riders = new Map();   // athleteId -> {bal: FrcBalance, pw: [{wt, p}], seen}
    }

    /* Every tick: entries = Sauce's nearby list; frcKJ = the FRC assumed for every rider. Returns the nearest flyer's
     * outlook {gapM, gapS, away, caughtAtM, leftKJ} or null. */
    update(entries, me, {frcKJ = FLYER.frcKJ, now = Date.now()} = {}) {
        const s = me && me.state;
        if (!s || !s.eventSubgroupId) return null;
        const frcJ = frcKJ * 1000;
        for (const o of entries || []) {
            const t = o.state, ftp = o.athlete && o.athlete.ftp;
            if (o === me || !t || t.eventSubgroupId !== s.eventSubgroupId || !(ftp > 0)) continue;
            let r = this.riders.get(o.athleteId);
            if (!r) this.riders.set(o.athleteId, r = {bal: new FrcBalance(), pw: []});
            r.seen = now;
            r.bal.update(t.worldTime, t.power || 0, {ftpW: ftp, frcJ});
            r.pw.push({wt: t.worldTime, p: t.power || 0});
            while (r.pw.length && r.pw[0].wt < t.worldTime - 10_000) r.pw.shift();
        }
        for (const [id, r] of this.riders) if (now - r.seen > FLYER.staleMs) this.riders.delete(id);
        if (me.remainingMetric !== 'distance' || !(me.remaining > 0) || me.remaining > FLYER.fromM) return null;
        // your group's front: forward from you while each next rider is within FLYER.groupM
        const field = [];
        for (const o of entries || []) {
            const t = o.state;
            if (!t || t.eventSubgroupId !== s.eventSubgroupId || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse) continue;
            const g = o === me ? 0 : gapBetween(me, o).gap;
            if (Number.isFinite(g)) field.push({o, g});
        }
        field.sort((a, b) => a.g - b.g);
        let front = 0;
        for (const x of field) if (x.g > front && x.g - front <= FLYER.groupM) front = x.g;
        const vP = (s.speed || 0) / 3.6;
        for (const {o, g} of field) {
            const gM = g - front, r = this.riders.get(o.athleteId);
            if (gM < FLYER.minM || gM > FLYER.maxM || !r) continue;
            const ftp = o.athlete.ftp;
            const pF = r.pw.reduce((a, x) => a + x.p, 0) / Math.max(1, r.pw.length);
            if (pF < FLYER.minFtp * ftp) continue;   // not attacking: riding away slower than FTP-ish isn't a flyer
            const leftJ = r.bal.read({frcJ}).leftJ;
            const vF = (o.state.speed || 0) / 3.6;
            const out = flyerOutlook({dF: Math.max(1, me.remaining - g), vF, pF, ftp, massKg: (o.athlete.weight || 75) + FLYER.bikeKg,
                                      leftJ, frcJ}, vP, me.remaining - front);
            return {gapM: gM, gapS: gM / Math.max(vP, 1), ...out, leftKJ: leftJ / 1000};
        }
        return null;
    }
}
