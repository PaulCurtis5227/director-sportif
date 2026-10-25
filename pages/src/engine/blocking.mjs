/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Blocked: power that went nowhere because you pushed into the wheel ahead (v0.58.0). In a pack the 1-tick energy
 * balance (power + Zwift's draft − air − rolling − change in kinetic and potential energy) has a steady shift — the
 * pack cost, charged by pack-cost.mjs — plus SPIKES: single ticks where 80+ W vanish (research/2026-10-11/
 * tick-tail.mjs; docs/FINDINGS.md "STEADY OR SPIKY"). The spikes are avoidable: on your clean rides 1–3% of pack ticks
 * vs 11–15% for the field and for you riding to power targets; they are ~1/3 of the field's average pack cost. The
 * pack cost charges only the steady part (pack-cost.mjs, refit without spike windows), so the watts lost in spikes
 * show up in Holding as waste, and this watch says where they come from. Pure: fed your own ticks.
 *
 * Blocked ALONGSIDE (v0.58.1): a failed pass on video (ECRO Chasing Bianche, Makuri dirt descent; docs/FINDINGS.md "A
 * FAILED PASS ON VIDEO"): pulling level with a rider, ~260 W vanished every second for 6 s — a sustained block beside
 * that rider, not single-tick spikes, though the user was lighter, on a better bike and out-pushing them. So spikes count
 * while a rider overlaps you beside (besideRider), not only behind someone, and the cue says so.
 * v0.58.2: in a bunch someone is 0.4–1.5 m aside within 2 m ~40% of the time (research/2026-10-11/my-blocks.mjs), so
 * "beside" now means a pass: real overlap (within BESIDE_ALONG_M along the road) while you are faster than that rider
 * or out-pushing them (the failed passes: lighter, better bike, more power, and stopped beside them).
 * v0.60.2: power-ups no longer blind the watch (it used to reset on any power-up and then need 10 s: AERO in a sprint
 * finish left it blank to the line, though a rider beside you lost 262 + 468 W in two ticks; docs/FINDINGS.md "BLOCKING
 * IN THAT SPRINT"). Each power-up's effect on your own physics goes into the balance instead (POWER_UPS).
 * v0.68.2 (DS 0.39.0): no spikes on fast descents (FAST_DESCENT_KMH, FAST_DESCENT_GRADE). There Zwift's draft swings
 * 0–340 W tick to tick and the balance can't tell that from blocking: 45+ km/h downhill read 11–35 W blocked on three
 * rides vs 1–8 W under 45 km/h (docs/FINDINGS.md "BLOCKED AT SPEED"). Fast flat finishes still count.
 * v0.68.5 (DS 0.42.0): mostly wrong. The spikes on descents follow the gap to the wheel (research/2026-10-24/
 * pack-speed.mjs, 2 races + 6 group rides; docs/FINDINGS.md "PACK COST AND HOLDING AT SPEED"): at 52+ km/h downhill
 * 77–78% of windows 0–3.5 m off the wheel have a spike (85–87 W left over) vs 26% / 17 W at 5.5–10 m: the cost of
 * sitting close, real and avoidable. So on a fast descent spikes count within FAST_DESCENT_CLOSE_M of the wheel in line
 * (or alongside a rider), and only further back, where the gap doesn't explain them, are they taken as the draft swinging.
 * v0.68.6 (DS 0.45.0, the 2026-10-25 ride): the passing cue compares speeds at your state time (accelKmhS: a bunch
 * speeding up read 1–4 km/h "closing" from states a second apart; "drop back" 17 times in that event, 3 after) and stays
 * quiet when your group goes through with you (WITH_N).
 */

import {leads} from './wheels.mjs';
import {UNIT_PER_M} from './pack-cost.mjs';

export const SPIKE_W = 80;          // a tick whose balance exceeds this lost power to blocking
export const BLOCK_WINDOW_S = 10;   // what the lost watts are averaged over
export const FAST_DESCENT_KMH = 45;      // a tick this fast...
export const FAST_DESCENT_GRADE = -0.01; // ...on a road this steep down or steeper counts spikes only...
export const FAST_DESCENT_CLOSE_M = 5.5;  // ...this close to the wheel in line (further back: the draft swinging)
export const BLOCK_CUE_W = 10;      // the cue: this many watts lost over the window...
export const BLOCK_CUE_N = 2;       // ...in at least this many spike ticks
export const BESIDE_ALONG_M = 1;    // a rider overlapping you along the road (wheels level within a meter)...
export const BESIDE_LAT_M = [0.4, 1.5];   // ...and this far to the side: beside you, not in your line...
export const PASS_KMH = 0.5;        // ...while you are this much faster than them...
export const PASS_POWER = 1.1;      // ...or pushing this many times their power: you are trying to get past
const RHO = 1.225, G = 9.80665;

/*
 * What each Zwift power-up does to YOUR physics (zwiftinsider.com/powerups/, /updated-feather-burrito/,
 * /update-1-39-0-110983/): AERO cuts CdA 25%; LIGHTNESS (feather) cuts body weight 10%; STEAMROLLER rolls like a road
 * tire on pavement whatever the tires and surface; ANVIL adds weight only on a descent of 1.5% or more, a share of your
 * body weight that is bigger for lighter riders (since May 2023, zwiftinsider.com/rebalanced-powerups/: 50 kg rider
 * +40 kg, 100 kg rider +22.6 kg; Zwift publishes no formula, so anvilKg runs a line through those two). DRAFTBOOST is in Zwift's reported draft already; the
 * burrito (UNDRAFTABLE), ghost (NINJA) and XP act on others or on nothing. Not listed (coffee stop, a teleport, a new
 * power-up) = unknown: the watch restarts, as before.
 */
export const POWER_UPS = {
    AERO: {cdaX: 0.75},
    LIGHTNESS: {bodyX: 0.9},
    STEAMROLLER: {roadCrr: true},
    ANVIL: {anvil: true, minDescent: 0.015},
    DRAFTBOOST: {}, UNDRAFTABLE: {}, NINJA: {}, BONUS_XP: {}, BONUS_XP_LIGHT: {},
};
export const ROAD_CRR = 0.0042;     // a road tire on pavement (the road Crr used for other riders, pack-cost.mjs)
const BIKE_KG = 8;                  // body weight = massKg - this when the caller gives no bodyKg
const ANVIL_POINTS = [[50, 40], [100, 22.6]];   // body kg -> anvil kg (ZI's tests)

/* The anvil's added weight for a rider of bodyKg: the line through ANVIL_POINTS, never below 0. */
export function anvilKg(bodyKg) {
    const [[w0, a0], [w1, a1]] = ANVIL_POINTS;
    return Math.max(0, a0 + (a1 - a0) * (bodyKg - w0) / (w1 - w0));
}

/* This tick's CdA, Crr and mass with its power-up on; grade = the road over the tick (for the anvil). Null: unknown. */
export function withPowerUp(tick, grade = 0) {
    const eff = tick.powerUp ? POWER_UPS[tick.powerUp] : {};
    if (!eff) return null;
    const body = Number.isFinite(tick.bodyKg) ? tick.bodyKg : tick.massKg - BIKE_KG;
    let m = tick.massKg - (eff.bodyX ? body * (1 - eff.bodyX) : 0);
    if (eff.anvil && grade <= -eff.minDescent) m += anvilKg(body);
    return {cda: tick.cda * (eff.cdaX || 1), crr: eff.roadCrr ? Math.min(tick.crr, ROAD_CRR) : tick.crr, m};
}

export class BlockWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.last = null;
        this.spikes = [];   // {wt, lostJ}
        this.lastWt = null;
        this.beside = null;
    }

    /*
     * tick: {wt (ms), v (m/s), alt (m), power, draft (W), massKg, bodyKg (optional: your weight, for the feather), cda,
     * crr, packW (the steady pack cost now), wheelGapM (m to the wheel in line, pack-cost.mjs packSituation; null =
     * none within 25 m), behind (true when someone is ahead of you in your group), beside
     * (besideRider() or null), powerUp (applied through POWER_UPS; an unknown one restarts the watch), coffee}.
     * Returns {lostW (W lost to spikes over BLOCK_WINDOW_S, null until there is a window), spikes (count in the
     * window), blocked (the cue), beside (the rider level with you now, or null), tickW (this tick's balance or null)}.
     */
    update(tick) {
        const ok = (!tick.powerUp || POWER_UPS[tick.powerUp]) && !tick.coffee && [tick.wt, tick.v, tick.alt, tick.massKg, tick.cda, tick.crr]
            .every(Number.isFinite) && tick.v * 3.6 >= 10;
        if (!ok) {
            this.reset();
            return this.read(tick.wt, null);
        }
        const a = this.last;
        if (a && !(tick.wt > a.wt)) return this.read(tick.wt, null);
        this.beside = tick.beside || null;
        this.last = {wt: tick.wt, v: tick.v, alt: tick.alt, p: Math.max(0, tick.power || 0), d: tick.draft || 0, tick};
        if (this.lastWt == null) this.lastWt = tick.wt;
        const dt = a ? (tick.wt - a.wt) / 1000 : null;
        if (!a || dt < 0.5 || dt > 2.5) return this.read(tick.wt, null);
        // each end of the tick with its own power-up; one mass for the energy change, so a power-up switching on or
        // off (the anvil's extra kilos) doesn't count as energy
        const run = (a.v + tick.v) / 2 * dt;
        const grade = run > 0.5 ? (tick.alt - a.alt) / run : 0;
        const e0 = withPowerUp(a.tick, grade), e1 = withPowerUp(tick, grade);
        const m = (e0.m + e1.m) / 2;
        const res = (a.p + this.last.p) / 2 + (a.d + this.last.d) / 2 -
            0.5 * RHO * (e0.cda * a.v ** 3 + e1.cda * tick.v ** 3) / 2 - G * (e0.crr * e0.m * a.v + e1.crr * e1.m * tick.v) / 2 -
            (0.5 * m * (tick.v ** 2 - a.v ** 2) + m * G * (tick.alt - a.alt)) / dt;
        // a fast descent: only close to the wheel (or alongside) is a spike the cost of where you are
        const fastDescent = (a.v + tick.v) / 2 * 3.6 >= FAST_DESCENT_KMH && grade <= FAST_DESCENT_GRADE;
        const close = !!tick.beside || (Number.isFinite(tick.wheelGapM) && tick.wheelGapM < FAST_DESCENT_CLOSE_M);
        if ((tick.behind || tick.beside) && (!fastDescent || close) && res > SPIKE_W) this.spikes.push({wt: tick.wt, lostJ: (res - Math.max(0, tick.packW || 0)) * dt});
        return this.read(tick.wt, res);
    }

    read(wt, tickW) {
        while (this.spikes.length && wt - this.spikes[0].wt > BLOCK_WINDOW_S * 1000) this.spikes.shift();
        const warm = this.lastWt != null && wt - this.lastWt >= BLOCK_WINDOW_S * 1000;
        const lostW = warm ? this.spikes.reduce((s, x) => s + x.lostJ, 0) / BLOCK_WINDOW_S : null;
        return {lostW, spikes: this.spikes.length, tickW, beside: this.beside,
                blocked: lostW != null && lostW >= BLOCK_CUE_W && this.spikes.length >= BLOCK_CUE_N};
    }
}

/*
 * The rider you are trying to pass: level with you, beside you (same road and direction, overlapping along the road
 * within BESIDE_ALONG_M, BESIDE_LAT_M to the side), while you are faster or out-pushing them. {side: 'left'|'right'
 * (as you ride), alongM, latM} for the nearest, or null.
 */
export function besideRider(entries, me, lead = leads(entries)) {
    if (!me || !me.state) return null;
    const s = me.state, mine = lead.get(me);
    if (mine == null) return null;
    let best = null;
    for (const o of entries || []) {
        if (o === me || !o.state || o.state.roadId !== s.roadId || !!o.state.reverse !== !!s.reverse) continue;
        const x = lead.get(o);
        if (x == null || Math.abs(x - mine) > BESIDE_ALONG_M) continue;
        // roadPosition + = the rider's right on roads ridden forward, left in reverse
        const lat = ((o.state.roadPosition ?? 0) - (s.roadPosition ?? 0)) / UNIT_PER_M * (s.reverse ? -1 : 1);
        if (Math.abs(lat) < BESIDE_LAT_M[0] || Math.abs(lat) > BESIDE_LAT_M[1]) continue;
        const passing = (s.speed || 0) - (o.state.speed || 0) >= PASS_KMH ||
            (s.power || 0) >= PASS_POWER * Math.max(1, o.state.power || 0);
        if (!passing) continue;
        if (!best || Math.abs(x - mine) < Math.abs(best.alongM)) best = {side: lat > 0 ? 'right' : 'left', alongM: x - mine, latM: lat};
    }
    return best;
}

/* One line for the cue. No watts in it: the meter's value is the measured loss (2026-10-12: notes quote only measured
 * numbers). */
export function blockedNote(r) {
    if (!r || r.lostW == null) return '';
    if (!r.blocked) return 'clear';
    return r.beside ? `blocked alongside a rider on your ${r.beside.side} — ease off and pass where there's room` :
        'blocked: pushing into the wheel — ease off or steer to space';
}

/*
 * The passing cue (v0.59.0; research/2026-10-11/field-trigger.mjs, docs/FINDINGS.md "THE BLOCK TRIGGER IS THE CLOSING
 * SPEED"): a rider who closes on another 1–5 km/h faster gets held — blocked up to 4× the pack's base rate at 2–3
 * km/h, ~150 W lost by them and only 12–28 W by the rider in the way — while a pass at 5+ km/h goes through. So: when
 * YOU close that slowly on a rider ahead or beside, go with more speed or wait; when a rider closes that slowly on
 * you, staying in their way costs them far more than you. Advice only, like every call here.
 * v0.59.1 (research/2026-10-11/pass-geometry.mjs, 160k pass attempts): below 5 km/h, a pass from just beside (0.4–1 m)
 * gets through 66–73% vs 75–83% from 1.5 m+ out, and pulling out at the wheel (< 1.5 m back) 70% / 7 s vs 3–5 m back
 * 75% / 4 s. So the cue says go wide, and glued to the wheel it says drop back and pull out early.
 * The ~150 / 12–28 W are losses in the SECOND a pass is held, not steady watts: held seconds are ~19% while creeping up
 * at 2–3 km/h, so on average ~30 W to the passer and ~4 W to the rider in the way. The defence note no longer quotes
 * them (user, 2026-10-12: numbers in the messages should be close to reality).
 */
export const HELD_KMH = [1, 5];     // closing this much faster gets you held
export const GO_KMH = 5;            // ...this much faster goes through
export const PASS_AHEAD_M = 4;      // a rider up to this far ahead (centre to centre)...
export const PASS_BEHIND_M = 4;     // ...or behind, for the defence
export const PASS_LAT_M = 1.5;      // ...and no more than this to the side
export const WIDE_M = 1.5;          // a pass this far out gets through more often at low closing speed
export const AT_WHEEL_M = 1.5;      // closer than this behind, in line: pulling out here is the worst pass
// Moving through with your group (v0.68.6; the user, 2026-10-25: "I was in a small group that overtook another small
// group. We were moving through them at a fair speed, the cue said to back off. At that point there was no telling if
// my group was going to ride through"): this many riders within WITH_M of you closing on the same rider as fast as you
// (within WITH_KMH) = your group is going through, and the cue stays quiet.
export const WITH_N = 2;
export const WITH_M = 10;
export const WITH_KMH = 1;

/* {attack, defend}: the nearest rider you close on, and the nearest closing on you, in the held band; each null or
 * {where: 'ahead'|'behind'|'on your left'|'on your right', closeKmh, alongM, latM, atWheel (attack: glued to their
 * wheel, in line)}. accelKmhS = your acceleration (km/h per s): each rider's speed is from their own state time, so
 * while a bunch speeds up together a state 1 s older read 1–2 km/h slower (the 2026-10-25 start, 12 -> 41 km/h in
 * 30 s: "drop back" over and over); their speed is moved to your state time at your acceleration. An attack your group
 * makes with you (WITH_N) is no attack. */
export function passSituation(entries, me, lead = leads(entries), {accelKmhS = 0} = {}) {
    const out = {attack: null, defend: null};
    if (!me || !me.state) return out;
    const s = me.state, mine = lead.get(me);
    if (mine == null) return out;
    for (const o of entries || []) {
        if (o === me || !o.state || o.state.roadId !== s.roadId || !!o.state.reverse !== !!s.reverse) continue;
        const x = lead.get(o);
        if (x == null) continue;
        const along = x - mine;   // + = they are ahead
        const lat = ((o.state.roadPosition ?? 0) - (s.roadPosition ?? 0)) / UNIT_PER_M * (s.reverse ? -1 : 1);
        if (Math.abs(lat) > PASS_LAT_M) continue;
        const level = Math.abs(along) <= BESIDE_ALONG_M && Math.abs(lat) >= BESIDE_LAT_M[0];
        const where = level ? `on your ${lat > 0 ? 'right' : 'left'}` : along > 0 ? 'ahead' : 'behind';
        const dtS = Number.isFinite(s.worldTime) && Number.isFinite(o.state.worldTime) ?
            Math.max(-2, Math.min(2, (s.worldTime - o.state.worldTime) / 1000)) : 0;
        const dv = (s.speed || 0) - ((o.state.speed || 0) + accelKmhS * dtS);   // km/h, + = you are faster
        if (dv >= HELD_KMH[0] && dv < HELD_KMH[1] && (level || (along > 0 && along <= PASS_AHEAD_M))) {
            const atWheel = !level && along < AT_WHEEL_M && Math.abs(lat) < BESIDE_LAT_M[0];
            if (!out.attack || Math.abs(along) < Math.abs(out.attack.alongM)) out.attack = {where, closeKmh: dv, alongM: along, latM: lat, atWheel, rider: o};
        }
        if (-dv >= HELD_KMH[0] && -dv < HELD_KMH[1] && (level || (along < 0 && along >= -PASS_BEHIND_M))) {
            if (!out.defend || Math.abs(along) < Math.abs(out.defend.alongM)) out.defend = {where, closeKmh: -dv, alongM: along, latM: lat};
        }
    }
    if (out.attack) {
        const target = out.attack.rider, tv = target.state.speed || 0;
        let n = 0;
        for (const o of entries || []) {
            if (o === me || o === target || !o.state || o.state.roadId !== s.roadId || !!o.state.reverse !== !!s.reverse) continue;
            const x = lead.get(o);
            if (x == null || Math.abs(x - mine) > WITH_M) continue;
            if ((o.state.speed || 0) - tv >= out.attack.closeKmh - WITH_KMH) n++;
        }
        if (n >= WITH_N) out.attack = null;
        else delete out.attack.rider;
    }
    return out;
}

/* Steadies the cue: on after two ticks in a row, off after two without (reported speeds wobble tick to tick). */
export class PassWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.on = {attack: 0, defend: 0};
        this.off = {attack: 0, defend: 0};
        this.shown = {attack: null, defend: null};
    }

    update(p) {
        for (const k of ['attack', 'defend']) {
            if (p && p[k]) {
                this.on[k]++;
                this.off[k] = 0;
                if (this.on[k] >= 2 || this.shown[k]) this.shown[k] = p[k];
            } else {
                this.off[k]++;
                this.on[k] = 0;
                if (this.off[k] >= 2) this.shown[k] = null;
            }
        }
        return {...this.shown};
    }
}

/* One line for the passing cue ('' when there is nothing to say); your own pass comes first. */
export function passNote(p) {
    if (!p) return '';
    if (p.attack) {
        const a = p.attack, c = `+${a.closeKmh.toFixed(1)} km/h`;
        if (a.atWheel) {
            return `on the wheel, closing at ${c}: pulling out here gets you held — drop to 3–5 m, pull out wide, ` +
                `come by with ${GO_KMH}+ km/h`;
        }
        return `closing at ${c} on a rider ${a.where}: that gets you held — go with ${GO_KMH}+ km/h more` +
            (Math.abs(a.latM ?? 0) < WIDE_M ? `, or go wide (${WIDE_M} m+)` : ', or wait');
    }
    if (p.defend) {
        return `rider ${p.defend.where} creeping up at +${p.defend.closeKmh.toFixed(1)} km/h: stay in their way — ` +
            'it costs them far more than you';
    }
    return '';
}
