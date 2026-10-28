/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Burrito dodging (v0.47.0; the user, 2026-10-26, ZRL Spiral Summit gives everyone a burrito in the pens: "hanging out
 * near them disables the draft. I am wondering if the correct strategy is to get near the front, wait until the
 * burritos are done, then slide back. The DS should be able to see that the burrito was fired by somebody, maybe count
 * them down to get an estimate of how many are left nearby").
 *
 * The burrito (Sauce: activePowerUp 'UNDRAFTABLE') turns off the draft for riders in a cone behind the rider who fired
 * it, for 20 s (Zwift Insider). Sauce shows every rider's active power-up (2026-10-06 race: 48 of 97 riders seen with
 * one), so a burrito shows the moment it's fired. In an event the whole subgroup arrives, so the riders who haven't
 * fired one yet can be counted: when everyone got one in the pens, that is how many are still to come. In play once
 * anyone fires one, or from the start when you hold one yourself (then everyone got one).
 * MEASURED (Spiral Summit 2026-10-27, 45 burritos, research/2026-10-27/burrito-cone.mjs): a short wedge. Riders 1–8.5 m
 * behind the firer, within a quarter of that distance either side, got no draft 90–100% of the time (2–8 m in line:
 * 98–99%; the same spots behind riders without one: 0–3%); at 9 m and beyond, the draft is back. Active 19–21 s.
 * Gaps aligned to one moment (wheels.mjs gapBetween): states arrive up to a second apart, 10+ m at race speed.
 *
 *   update(entries, me, wt) -> null (not in an event, or no burritos in play) or {state, firedN, othersN, unfiredN,
 *       unfiredAheadN, activeN, cone: {aheadM, sideM} | null}; state: 'cone' (an active burrito just ahead of you:
 *       move over) | 'ahead' (unfired burritos ahead of you) | 'done' (for DONE_S once nearly everyone has fired) | 'clear'
 */

import {gapBetween} from './engine/wheels.mjs';

export const BURRITO = {
    activeS: 20,       // a burrito lasts this long (Zwift Insider)
    fromM: 1,          // the cone: from this far behind the rider who fired it ...
    aheadM: 8.5,       // ... to this far (sharp: 9 m back has the draft)
    widen: 0.25,       // half-width = this × the distance back (2 m back: ±0.5 m; 8 m: ±2 m)
    marginM: 0.3,      // sideways slack (positions jitter)
    doneShare: 0.9,    // nearly everyone has fired theirs
    doneS: 10,         // "burritos done" shows this long
};
const UNITS_PER_M = 113513;   // roadPosition units per meter sideways

/* Are you in a burrito's cone: aheadM = the firer's lead on you, sideM = how far aside (null: unknown, taken as in line). */
export function inCone(aheadM, sideM) {
    if (!(aheadM >= BURRITO.fromM && aheadM <= BURRITO.aheadM)) return false;
    return sideM == null || Math.abs(sideM) <= BURRITO.widen * aheadM + BURRITO.marginM;
}

export class BurritoWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.sg = null;
        this.fired = new Map();   // athleteId -> worldTime first seen with it active
        this.doneAt = null;
        this.inPlay = false;      // you held one in this event, or someone fired one
    }

    update(entries, me, wt) {
        const sg = me && me.state ? me.state.eventSubgroupId || null : null;
        if (!sg) {
            if (this.sg) this.reset();
            return null;
        }
        if (sg !== this.sg) {
            this.reset();
            this.sg = sg;
        }
        const others = (entries || []).filter(e => e && !e.self && e.state && e.state.eventSubgroupId === sg);
        const aheadOf = e => (Number.isFinite(e.gapDistance) ? gapBetween(me, e).gap : NaN);   // m, + = ahead of you
        const sideOf = e => Number.isFinite(e.state.roadPosition) && Number.isFinite(me.state.roadPosition) ?
            Math.abs(e.state.roadPosition - me.state.roadPosition) / UNITS_PER_M : null;
        const active = [];
        for (const e of others) {
            if (e.state.activePowerUp !== 'UNDRAFTABLE') continue;
            if (!this.fired.has(e.athleteId)) this.fired.set(e.athleteId, wt);
            if (wt - this.fired.get(e.athleteId) <= BURRITO.activeS * 1000 + 2000) active.push(e);
        }
        if (me.gameState && me.gameState.availablePowerUp === 'UNDRAFTABLE') this.inPlay = true;
        if (this.fired.size) this.inPlay = true;
        if (!this.inPlay) return null;
        const firedN = others.filter(e => this.fired.has(e.athleteId)).length;
        const unfired = others.filter(e => !this.fired.has(e.athleteId));
        const unfiredAheadN = unfired.filter(e => aheadOf(e) > 0).length;
        let cone = null;
        for (const e of active) {
            const a = aheadOf(e), s = sideOf(e);
            const sameRoad = e.state.roadId == null || me.state.roadId == null ||
                (e.state.roadId === me.state.roadId && !!e.state.reverse === !!me.state.reverse);
            if (sameRoad && inCone(a, s) && (!cone || a < cone.aheadM)) {
                cone = {aheadM: a, sideM: s};
            }
        }
        if (this.doneAt == null && others.length && firedN >= BURRITO.doneShare * others.length) this.doneAt = wt;
        const state = cone ? 'cone' : this.doneAt != null && wt - this.doneAt <= BURRITO.doneS * 1000 ? 'done' :
            this.doneAt == null && unfiredAheadN > 0 ? 'ahead' : 'clear';
        return {state, firedN, othersN: others.length, unfiredN: unfired.length, unfiredAheadN, activeN: active.length, cone};
    }
}
