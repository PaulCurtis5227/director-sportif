/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Did it work? (the user, 2026-11-02: "I felt like I was just doing random stuff"; a done chime, a failed chime, the text
 * colored, for step, block and ease off.) A call opens a question; this answers it from where the riders are, not from
 * the block spikes, which take ~4 s to say a block is over: too late to tie the sound to what you did.
 *
 * Only if you tried ("step left (I moved left), Block (I moved to block), ease off, I actually lowered power"): no try, no
 * sound, whatever happens, so a tone always answers something you did and silence means you didn't.
 *   tried: step, block = you steered (Zwift's activeSteer, since the call) and moved OUTCOME.tryM+ the way called (toward the
 *     rider for a block); ease off = your power fell OUTCOME.easeShare under what it was at the call. The flag says you steered,
 *     not which way, and without it half of any 8 s moves you 0.3 m anyway: Zwift carries a rider who isn't steering
 *     (research/2026-11-02/steer.mjs). No steering device (canSteer false): the move alone.
 *   step left / right, ease off: done = tried, and clear of the wheel: no rider 0.5–3.5 m ahead under 0.6 m off your line (the
 *     block is gone 0.6–0.8 m aside or 3 m back; docs/FINDINGS.md). failed = tried, still there OUTCOME.afterS later.
 *   block left / right: done = tried, and that rider is now in line behind you; failed = tried, and they came level anyway.
 *     In line is where they get held: not proof they were.
 *
 *   update(call, ds, wt) -> null or {result: 'done' | 'failed', word}: once per question.
 */
import {leads} from './engine/wheels.mjs';
import {UNIT_PER_M} from './engine/pack-cost.mjs';

export const OUTCOME = {
    tryS: 8,              // this long from the call to try (~5 s to move 0.5 m, research/2026-11-02/react.mjs)
    afterS: 4,            // step / ease off: this long after you tried to get clear
    blockS: 14,           // block: no answer by now, no word
    ticks: 2,             // read twice in a row (positions wobble)
    againS: 15,           // no new question of a kind this soon after an answer: a call still on must not fail every 8 s
    showS: 3,             // the colored word stays this long (meters.mjs)
    wheelM: [0.5, 3.5],   // a wheel you are held on...
    lineM: 0.6,           // ...under this off your line
    tryM: 0.3,            // moved this far the way called, steering = you tried
    easeShare: 0.15,      // power down this much = you tried
    easeTicks: 3,         // power read over this many ticks
    inLineM: 0.45,        // block: this close to your line...
    behindM: 0.75,        // ...and still this far behind you; level with you = failed
    aroundM: 12,
};
export const OUTCOME_TONES = {done: [1319, 1760], failed: [392, 294]};   // high and rising; low and falling

/* The riders near you: {id, along (+ = ahead), lat (+ = your right)}. */
export function aroundYou(entries, me, lead = leads(entries)) {
    const s = me && me.state, mine = lead.get(me), out = [];
    if (!s || mine == null) return out;
    for (const o of entries || []) {
        if (o === me || !o.state || o.state.roadId !== s.roadId || !!o.state.reverse !== !!s.reverse) continue;
        const x = lead.get(o);
        if (x == null || Math.abs(x - mine) > OUTCOME.aroundM) continue;
        out.push({id: o.athleteId, along: x - mine, lat: ((o.state.roadPosition ?? 0) - (s.roadPosition ?? 0)) / UNIT_PER_M * (s.reverse ? -1 : 1)});
    }
    return out;
}

const held = around => (around || []).some(o => o.along >= OUTCOME.wheelM[0] && o.along <= OUTCOME.wheelM[1] && Math.abs(o.lat) < OUTCOME.lineM);

function kindOf(call) {
    if (!call) return null;
    if (call.id === 'passed') return 'block';
    if ((call.id === 'step' || call.id === 'blocked') && ['step-left', 'step-right'].includes(call.state)) return 'step';   // 'step' from v0.57.0
    if ((call.id === 'blocked' || call.id === 'nudge') && call.state === 'wheel') return 'ease';
    return null;
}

export class OutcomeWatch {
    constructor() {
        this.q = null;
        this.answered = {};   // kind -> wt
        this.power = [];      // the last few ticks
    }

    answer(result, wt) {
        const {kind, word} = this.q;
        this.q = null;
        this.answered[kind] = wt;
        return {result, word};
    }

    meanPower() {
        return this.power.reduce((a, b) => a + b, 0) / (this.power.length || 1);
    }

    tried(q, ds) {
        if (q.kind === 'ease') return this.meanPower() <= q.power0 * (1 - OUTCOME.easeShare);
        return (q.steered || ds.canSteer === false) && (ds.lane - q.lane0) * q.way >= OUTCOME.tryM;
    }

    open(kind, call, ds, wt) {
        const around = (ds && ds.around) || [];
        const q = {kind, word: call.word, at: wt, n: 0, triedAt: null, lane0: ds.lane, power0: this.meanPower()};
        if (kind === 'block') {
            const r = around.find(o => o.id === ds.passRiderId);
            if (!r) return;
            this.q = {...q, id: r.id, way: Math.sign(r.lat)};
        } else if (held(around)) {
            this.q = {...q, way: call.state === 'step-right' ? 1 : -1};
        }
    }

    update(call, ds, wt) {
        this.power.push((ds && ds.powerW) || 0);
        if (this.power.length > OUTCOME.easeTicks) this.power.shift();
        const kind = kindOf(call);
        if (kind && !this.q && !(wt - (this.answered[kind] ?? -Infinity) < OUTCOME.againS * 1000)) {
            this.open(kind, call, ds, wt);
            return null;   // counted from the next tick
        }
        const q = this.q;
        if (!q) return null;
        if (ds && ds.steering) q.steered = true;
        if (q.triedAt == null && this.tried(q, ds)) q.triedAt = wt;
        const tried = q.triedAt != null;
        const around = (ds && ds.around) || [];
        if (q.kind !== 'block') {
            q.n = held(around) ? 0 : q.n + 1;
            if (q.n >= OUTCOME.ticks) {   // clear: with no try it isn't yours to hear about
                if (tried) return this.answer('done', wt);
                this.q = null;
                return null;
            }
            if (tried && wt - q.triedAt >= OUTCOME.afterS * 1000) return this.answer('failed', wt);
            if (!tried && wt - q.at >= OUTCOME.tryS * 1000) this.q = null;
            return null;
        }
        const r = around.find(o => o.id === q.id);
        const inLine = r && tried && Math.abs(r.lat) <= OUTCOME.inLineM && r.along <= -OUTCOME.behindM;
        q.n = inLine ? q.n + 1 : 0;
        if (q.n >= OUTCOME.ticks) return this.answer('done', wt);
        if (r && r.along > -OUTCOME.behindM) {
            if (tried) return this.answer('failed', wt);
            this.q = null;
            return null;
        }
        if (!r || wt - q.at >= OUTCOME.blockS * 1000) this.q = null;
        return null;
    }
}
