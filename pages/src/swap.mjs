/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coached bike swap, to practice (v0.70.0; the user, 2026-11-20: "setup something to practice bike swaps on. Maybe
 * an enable setting that makes another button that starts off the bike swap process"; docs/PLAN.md §18, A: the coach
 * beside your own swap keys). You press Swap; the director calls each step:
 *   1. "coast to a stop" while you are moving (brake or coast: the DS can't tell, only your speed);
 *   2. "swap now" once you have stopped (the first update under STOP_KMH): press your own swap key;
 *   3. "go go go" goS after "swap now" (the Swap: go after setting, to learn from practice: how long after the press
 *      riding away is safe). Riding off before that = an early go (logged as such).
 * At "go" the DS trades its bike setting for the swap bike (meters.mjs: bike <-> swapBike, wheels <-> swapWheels), so the
 * meters' drag is right straight away and the next swap goes back. Press Swap again before "go" = cancelled, no trade.
 * Coasting longer than COAST_MAX_S = given up.
 * Heard on time (the user, 2026-11-20: "Can't you predict the stopping message and get that .7 seconds back?"): the
 * sound takes leadS to reach you (meters.mjs: the chime's wait + the voice starting + your Audio delay), so "swap now"
 * starts when your last two speeds say you will be at 0 within leadS (slowing in a straight line; under PREDICT_KMH),
 * and "go go go" leadS before its time. A stop inside one update (a hard brake) has nothing to go on: the first 0.
 * The go wait counts from the stop as predicted.
 *
 * Nothing goes to Zwift: your own key does the swap, every time (no-automated-race-actions). Each step is logged into
 * the recording (meters.mjs rec.event {swap: step, ...}) so the practice can be measured: speed at the press, time to
 * stop, time stopped, the first watts after "go". Pure: worldTime in, the state out.
 *
 *   coach.press()                         from the Swap button; applied on the next update
 *   coach.update({wt, speedKmh}) -> {state: 'coast' | 'swap' | 'go' | null, word, n, step (a step entered on this
 *                                    update: 'press' | 'stopped' | 'go' | 'cancel' | 'gaveUp' | 'done', else null),
 *                                    early, trade (true on the 'go' step)}
 *   coach.active                          a swap under way (the button lit)
 */

export const STOP_KMH = 0.5;      // stopped: under this
export const STOP_TICKS = 1;      // on this many of your updates in a row: the first 0 (the user, 2026-11-20: two seconds of 0 was far too long)
export const MOVING_KMH = 3;      // in 'swap', riding off faster than this (and speeding up) = going (early, before "go")
export const PREDICT_KMH = 15;    // a stop is predicted only from under this
export const LEAD_S_RANGE = [0, 3];
export const COAST_MAX_S = 120;   // coasting this long without stopping: given up
export const GO_SHOW_S = 4;       // "go go go" stays on screen this long
export const GO_S_RANGE = [0, 10];
export const DEFAULT_GO_S = 3;

export const SWAP_WORDS = {coast: 'coast to a stop', swap: 'swap now', go: 'go go go'};

export const goSOf = x => {
    const n = Number(x);
    return x !== '' && x != null && Number.isFinite(n) ? Math.max(GO_S_RANGE[0], Math.min(GO_S_RANGE[1], n)) : DEFAULT_GO_S;
};

export class SwapCoach {
    constructor({goS = DEFAULT_GO_S, leadS = 0} = {}) {
        this.goS = goS;          // a number, or a function read at each update (the setting can change)
        this.leadS = leadS;      // the same: how long a call takes to reach your ears
        this.prev = null;        // your last update {wt, v}
        this.state = null;
        this.n = 0;              // swaps started: the call's state carries it, so a second practice swap is said again
        this.pressed = false;
        this.since = null;       // worldTime the state began
        this.still = 0;
        this.early = false;
    }

    get active() {
        return this.state === 'coast' || this.state === 'swap' || this.pressed;
    }

    press() {
        this.pressed = true;   // under way: called off; else (or showing "go") a new swap
    }

    _goS() {
        return goSOf(typeof this.goS === 'function' ? this.goS() : this.goS);
    }

    _leadS() {
        const n = Number(typeof this.leadS === 'function' ? this.leadS() : this.leadS);
        return Number.isFinite(n) ? Math.max(LEAD_S_RANGE[0], Math.min(LEAD_S_RANGE[1], n)) : 0;
    }

    // seconds to your stop from the last two speeds, or null (not slowing, too fast, no data)
    _toStopS(wt, v) {
        const p = this.prev;
        if (!p || v == null || p.v == null || !(v < PREDICT_KMH) || !(wt > p.wt) || !(p.v > v)) return null;
        const decel = (p.v - v) / ((wt - p.wt) / 1000);   // km/h a second
        return v / decel;
    }

    _out(step, extra = {}) {
        return {state: this.state, word: this.state ? SWAP_WORDS[this.state] : null, n: this.n, step,
                early: this.early, trade: step === 'go', ...extra};
    }

    update({wt, speedKmh}) {
        const v = Number.isFinite(speedKmh) ? speedKmh : null;
        if (!Number.isFinite(wt)) return this._out(null);
        const out = this._update(wt, v);
        this.prev = {wt, v};
        return out;
    }

    _update(wt, v) {
        this.still = v != null && v < STOP_KMH ? this.still + 1 : 0;
        const lead = this._leadS();
        if (this.pressed) {
            this.pressed = false;
            if (this.state === 'coast' || this.state === 'swap') {   // pressed again: called off
                this.state = null;
                return this._out('cancel');
            }
            this.n++;
            this.early = false;
            this.state = 'coast';
            this.since = wt;
            if (this.still >= STOP_TICKS) return this._stopped(wt, 'press');   // already stopped: straight to "swap now"
            return this._out('press', {speedKmh: v});
        }
        if (this.state === 'coast') {
            if (this.still >= STOP_TICKS) return this._stopped(wt, 'stopped');
            const toStop = this._toStopS(wt, v);
            if (toStop != null && toStop <= lead) return this._stopped(wt + toStop * 1000, 'stopped', {predicted: true, toStopS: toStop});
            if (wt - this.since > COAST_MAX_S * 1000) {
                this.state = null;
                return this._out('gaveUp');
            }
            return this._out(null);
        }
        if (this.state === 'swap') {
            const off = v != null && v > MOVING_KMH && !(this.prev && this.prev.v != null && v <= this.prev.v);
            const goAt = this.since + (this._goS() - lead) * 1000;
            if (off || wt >= goAt) {
                this.early = off && wt < goAt;
                this.state = 'go';
                this.since = wt;
                return this._out('go');
            }
            return this._out(null);
        }
        if (this.state === 'go' && wt - this.since >= GO_SHOW_S * 1000) {
            this.state = null;
            return this._out('done');
        }
        return this._out(null);
    }

    _stopped(stopWt, step, extra = {}) {
        this.state = 'swap';
        this.since = stopWt;   // the go wait counts from the stop (predicted: a moment from now)
        return this._out(step, extra);
    }
}
