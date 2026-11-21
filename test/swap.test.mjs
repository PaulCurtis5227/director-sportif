/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * v0.70.0 (the user, 2026-11-20): "setup something to practice bike swaps on. Maybe an enable setting that makes another
 * button that starts off the bike swap process"; "The button should start OBS if it is available".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SwapCoach, goSOf, STOP_TICKS, COAST_MAX_S, GO_SHOW_S, DEFAULT_GO_S, SWAP_WORDS} from '../pages/src/swap.mjs';
import {directorCalls} from '../pages/src/ds-data.mjs';
import {deliveryDefaults, deliveryKey, URGENT_TYPES, FINALE_CALLS, CALL_TYPES} from '../pages/src/calls.mjs';

// one update a second: [speed km/h, ...] -> the steps seen
const ride = (coach, speeds, {t0 = 1e6, pressAt = 0} = {}) => {
    const out = [];
    speeds.forEach((v, i) => {
        if (i === pressAt) coach.press();
        const r = coach.update({wt: t0 + i * 1000, speedKmh: v});
        out.push(r);
    });
    return out;
};

test('press, coast to a stop, swap now once stopped, go go go after the wait, then done', () => {
    const c = new SwapCoach({goS: 3});
    const r = ride(c, [30, 20, 10, 2, 0, 0, 0, 0, 0, 0, 5, 20, 25, 30, 30, 30]);
    const steps = r.map(x => x.step).filter(Boolean);
    assert.deepEqual(steps, ['press', 'stopped', 'go', 'done']);
    assert.equal(r[0].word, SWAP_WORDS.coast);
    const stopAt = r.findIndex(x => x.step === 'stopped');
    assert.equal(stopAt, 4 + STOP_TICKS - 1, 'stopped on the first update at 0');
    assert.equal(r[stopAt].word, 'swap now');
    const goAt = r.findIndex(x => x.step === 'go');
    assert.equal(goAt - stopAt, 3, '3 s after swap now');
    assert.equal(r[goAt].word, 'go go go');
    assert.equal(r[goAt].trade, true, 'the bike is traded at go');
    assert.equal(r[goAt].early, false);
    assert.equal(r.findIndex(x => x.step === 'done') - goAt, GO_SHOW_S);
    assert.equal(c.active, false);
});

test('already stopped at the press: swap now at once', () => {
    const c = new SwapCoach();
    const r = ride(c, [0, 0, 0, 0, 0, 0, 0], {pressAt: 2});
    assert.equal(r[2].step, 'press');
    assert.equal(r[2].state, 'swap');
    assert.equal(r[2].word, 'swap now');
    assert.equal(r[2 + DEFAULT_GO_S].step, 'go');
});

test('riding off before go = an early go; press again = cancelled, no trade; coasting forever = given up', () => {
    const early = ride(new SwapCoach({goS: 5}), [0, 0, 0, 10, 20]);
    const go = early.find(x => x.step === 'go');
    assert.ok(go && go.early, 'early go');
    const c = new SwapCoach();
    c.press();
    assert.equal(c.update({wt: 1000, speedKmh: 30}).step, 'press');
    assert.equal(c.active, true);
    c.press();
    const x = c.update({wt: 2000, speedKmh: 25});
    assert.equal(x.step, 'cancel');
    assert.equal(x.trade, false);
    assert.equal(c.active, false);
    const g = new SwapCoach();
    g.press();
    g.update({wt: 0, speedKmh: 30});
    assert.equal(g.update({wt: (COAST_MAX_S + 1) * 1000, speedKmh: 20}).step, 'gaveUp');
});

test('a second practice swap carries a new number, so its words are said again', () => {
    const c = new SwapCoach({goS: 1});
    const r = ride(c, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], {pressAt: 2});
    c.press();
    const again = c.update({wt: 1e6 + 20000, speedKmh: 0});
    assert.equal(again.step, 'press');
    assert.notEqual(again.n, r[2].n);
    const calls = n => directorCalls({swap: {state: 'swap', word: 'swap now', n}}).find(x => x.id === 'swap');
    assert.notEqual(calls(1).state, calls(2).state);
});

test('junk: the go wait, no world time, no speed', () => {
    assert.equal(goSOf('2.5'), 2.5);
    for (const j of ['', null, undefined, 'x', NaN]) assert.equal(goSOf(j), DEFAULT_GO_S, String(j));
    assert.equal(goSOf(-4), 0);
    assert.equal(goSOf(99), 10);
    const c = new SwapCoach({goS: () => 'junk'});
    c.press();
    assert.equal(c.update({wt: undefined, speedKmh: 0}).step, null, 'no time: waits');
    assert.equal(c.update({wt: 0, speedKmh: undefined}).step, 'press');
    assert.equal(c.update({wt: 1000, speedKmh: null}).step, null, 'no speed: not stopped');
});

test('the swap call: over everything, heard by everyone, in the finish too, no type wait', () => {
    const calls = directorCalls({swap: {state: 'coast', word: 'coast to a stop', n: 1}, join: {state: 'now', word: 'join now'}});
    const top = calls.reduce((a, b) => (b.priority > a.priority ? b : a));
    assert.equal(top.id, 'swap');
    assert.equal(top.word, 'coast to a stop');
    assert.equal(directorCalls({swap: {state: null, word: null, n: 1}}).some(x => x.id === 'swap'), false);
    assert.ok(CALL_TYPES.some(t => t.id === 'swap'));
    assert.ok(URGENT_TYPES.has('swap'));
    assert.ok(FINALE_CALLS['run-in'].has('swap') && FINALE_CALLS.sprint.has('swap'));
    for (const old of [{}, {speakCalls: false, callPassChime: true}]) {
        const d = deliveryDefaults(old);
        assert.equal(d[deliveryKey('swap', 'voice')], true);
        assert.equal(d[deliveryKey('swap', 'chime')], true);
    }
});

test('"swap now" predicted: started leadS before you reach 0, "go go go" leadS early too (the user: "get that .7 seconds back")', () => {
    // braking 4 km/h a second: 8, 4 -> at 4 km/h the stop is 1 s off; with 1 s of lead that's now
    const c = new SwapCoach({goS: 3, leadS: 1});
    const r = ride(c, [12, 8, 4, 0, 0, 0, 0, 0, 0]);
    const at = r.findIndex(x => x.step === 'stopped');
    assert.equal(at, 2, 'said at 4 km/h, a second before the 0');
    assert.equal(r[at].predicted, true);
    assert.ok(Math.abs(r[at].toStopS - 1) < 1e-9);
    // the wait counts from the stop (t = 3 s), and go is said 1 s early: at t = 3 + 3 - 1 = 5
    assert.equal(r.findIndex(x => x.step === 'go'), 5);
    assert.equal(r[5].early, false, 'still at 0: not an early go');
    // with 0.7 s of lead it waits for the 0 (1 s off is too far ahead)
    const d = new SwapCoach({goS: 3, leadS: 0.7});
    assert.equal(ride(d, [12, 8, 4, 0, 0]).findIndex(x => x.step === 'stopped'), 3);
});

test('no prediction from a speed-up, a steady speed, too fast, or a stop inside one update; junk lead = 0', () => {
    for (const speeds of [[4, 5, 6], [5, 5, 5], [40, 30, 20]]) {
        const c = new SwapCoach({leadS: 3});
        assert.equal(ride(c, speeds).some(x => x.step === 'stopped'), false, String(speeds));
    }
    const hard = new SwapCoach({leadS: 0.7});
    assert.equal(ride(hard, [25, 0]).findIndex(x => x.step === 'stopped'), 1, 'hard brake: the first 0');
    for (const junk of ['x', null, NaN, () => undefined]) {
        const c = new SwapCoach({goS: 2, leadS: junk});
        assert.equal(ride(c, [0, 0, 0, 0]).findIndex(x => x.step === 'go'), 2, String(junk));
    }
    // a predicted stop that doesn't come (brake let off, still rolling at 2 km/h): not taken for riding off
    const c = new SwapCoach({goS: 5, leadS: 1});
    const r = ride(c, [6, 3, 2, 2, 2]);
    assert.equal(r[1].step, 'stopped');
    assert.equal(r.some(x => x.step === 'go'), false);
});
