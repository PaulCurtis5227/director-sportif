/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {OutcomeWatch, OUTCOME, aroundYou} from '../pages/src/outcome.mjs';

const step = {id: 'blocked', state: 'step-left', word: 'step left'};
const ease = {id: 'blocked', state: 'wheel', word: 'ease off'};
const block = {id: 'passed', state: 'left', word: 'block left'};
const wheel = (along = 2, lat = 0) => ({id: 2, along, lat});
const tick = (call, around, {lane = 0, powerW = 200, passRiderId = null, steering = true, canSteer = true} = {}) => [call, {around, lane, powerW, passRiderId, steering, canSteer}];
const run = seq => {
    const w = new OutcomeWatch();
    return seq.map(([call, ds], i) => w.update(call, ds, i * 1000)).filter(Boolean);
};
const times = (n, x) => Array.from({length: n}, () => x);

test('step: done when you moved that way and got clear', () => {
    assert.deepEqual(run([tick(step, [wheel()]), tick(null, [wheel(2, 0.3)], {lane: -0.3}), tick(null, [wheel(2, 0.7)], {lane: -0.7}), tick(null, [wheel(2, 0.8)], {lane: -0.8})]),
        [{result: 'done', word: 'step left'}]);
});

test('step: failed when you moved that way and are still on the wheel', () => {
    const r = run([tick(step, [wheel()]), tick(step, [wheel()], {lane: -0.4}), ...times(OUTCOME.afterS, tick(step, [wheel(2, 0.2)], {lane: -0.4}))]);
    assert.deepEqual(r, [{result: 'failed', word: 'step left'}]);
});

test('step: no try, no tone, whatever happens', () => {
    assert.deepEqual(run(times(2 * OUTCOME.tryS, tick(step, [wheel()]))), [], 'stayed on the wheel');
    assert.deepEqual(run([tick(step, [wheel()]), tick(null, []), tick(null, []), tick(null, [])]), [], 'the wheel left by itself');
    assert.deepEqual(run([tick(step, [wheel()]), tick(step, [wheel()], {lane: 0.4}), ...times(OUTCOME.afterS + 1, tick(step, [wheel()], {lane: 0.4}))]), [], 'the other way');
    assert.deepEqual(run([tick(step, [wheel()]), ...times(OUTCOME.afterS + 1, tick(step, [wheel()], {lane: -0.2}))]), [], 'a small move is not a try');
    const carried = {lane: -0.8, steering: false};
    assert.deepEqual(run([tick(step, [wheel()]), tick(null, [wheel(2, 0.8)], carried), tick(null, [wheel(2, 0.8)], carried), tick(null, [wheel(2, 0.8)], carried)]), [], 'Zwift carried you: no try');
    assert.equal(run([tick(step, [wheel()]), tick(null, [wheel(2, 0.8)], {lane: -0.8, steering: false, canSteer: false}), tick(null, [wheel(2, 0.8)], {lane: -0.8, steering: false, canSteer: false}), tick(null, [wheel(2, 0.8)], {lane: -0.8, steering: false, canSteer: false})])[0].result, 'done', 'no steering device: the move alone');
});

test('ease off: tried means your power fell', () => {
    const before = times(3, tick(null, [wheel()], {powerW: 300}));
    const off = [...before, tick(ease, [wheel()], {powerW: 300}), ...times(3, tick(ease, [wheel()], {powerW: 200}))];
    assert.deepEqual(run([...off, tick(null, [wheel(3.6)], {powerW: 200}), tick(null, [wheel(3.8)], {powerW: 200})]), [{result: 'done', word: 'ease off'}]);
    assert.equal(run([...off, ...times(OUTCOME.afterS + 1, tick(ease, [wheel()], {powerW: 200}))])[0].result, 'failed');
    assert.deepEqual(run([...before, tick(ease, [wheel()], {powerW: 300}), tick(null, [wheel(3.6)], {powerW: 300}), tick(null, [wheel(3.8)], {powerW: 300})]), [], 'the gap opened with no easing');
});

test('a call still on doesn\'t fail again and again; no question off the wheel, or for other calls', () => {
    const on = [tick(step, [wheel()]), ...times(3 * OUTCOME.tryS, tick(step, [wheel()], {lane: -0.4}))];
    assert.equal(run(on).length, 1);
    assert.deepEqual(run([tick(step, [wheel(2, 1)]), tick(null, [], {lane: -1}), tick(null, [], {lane: -1}), tick(null, [], {lane: -1})]), []);
    assert.deepEqual(run([tick({id: 'gap', state: 'opening', word: 'gap opening'}, []), tick(null, [], {lane: -1}), tick(null, [], {lane: -1})]), []);
});

test('block: you moved toward them: done when they are in line behind you, failed when they come level', () => {
    const r = (along, lat) => ({id: 2, along, lat});
    const ask = {passRiderId: 2};
    assert.deepEqual(run([tick(block, [r(-6, -0.8)], ask), tick(null, [r(-5, -0.5)], {lane: -0.3}), tick(null, [r(-4, -0.3)], {lane: -0.5}), tick(null, [r(-3.5, -0.2)], {lane: -0.6})]),
        [{result: 'done', word: 'block left'}]);
    assert.deepEqual(run([tick(block, [r(-3, -0.8)], ask), tick(null, [r(-2, -0.5)], {lane: -0.3}), tick(null, [r(-0.5, -0.5)], {lane: -0.3})]),
        [{result: 'failed', word: 'block left'}]);
});

test('block: no try, no tone', () => {
    const r = (along, lat) => ({id: 2, along, lat});
    const ask = {passRiderId: 2};
    assert.deepEqual(run([tick(block, [r(-6, -0.8)], ask), tick(null, [r(-5, -0.5)]), tick(null, [r(-4, -0.3)]), tick(null, [r(-3.5, -0.2)])]), [], 'they drifted into line');
    assert.deepEqual(run([tick(block, [r(-3, -0.8)], ask), tick(null, [r(-2, -0.8)]), tick(null, [r(-0.5, -0.8)])]), [], 'they came level, you did nothing');
    assert.deepEqual(run([tick(block, [r(-3, -0.8)], ask), tick(null, [], {lane: -0.4}), tick(null, [], {lane: -0.4})]), [], 'gone');
});

test('around you: along, your right is +, reverse flips it', () => {
    const rider = (id, gap, pos, reverse = false, self = false) => ({athleteId: id, self, gapDistance: gap, state: {worldTime: 1000, speed: 36, roadId: 1, reverse, roadPosition: pos}});
    const me = rider(1, 0, 10000000, false, true), o = rider(2, -3, 10113513);
    assert.deepEqual(aroundYou([me, o], me).map(x => [x.id, Math.round(x.along), Math.round(x.lat)]), [[2, 3, 1]]);
    const meR = rider(1, 0, 10000000, true, true), oR = rider(2, -3, 10113513, true);
    assert.equal(Math.round(aroundYou([meR, oR], meR)[0].lat), -1);
});
