/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * v0.57.0 (the user, 2026-11-05: "the most important thing is that the software stops telling me to do the wrong
 * thing"; 1 call a minute; bends their own timer; every spoken call your choice): no hold calls while you move up
 * through the group, the bends' own lane, only calls you can hear compete, the split call rows, the Wheel gap color.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {dsCall, engineCall, engineCalls, isHoldCall, movingThrough, THROUGH_KMH, Announcer, BEND_LANE, CROSS_GAP_S,
    deliveryDefaults, deliveryFor, SPLIT_FROM, CALL_TYPES} from '../pages/src/calls.mjs';
import {gapLevel, GAP_GOOD_M} from '../pages/src/ds-data.mjs';
import {MeterEngine, THROUGH_S} from '../pages/src/meter-engine.mjs';

const meters = (blocked, passing, position) => ({meters: {blocked: {state: blocked}, passing: {state: passing}, position: {state: position}}});
const nudge = state => ({id: 'nudge', state, word: 'ease off', in: null, for: null, priority: 50});
const bend = {id: 'bend', state: 'open-right', word: 'move right', in: 6, for: null, priority: 45};

test('moving through the group: no ease off, drop back, give room or being passed; step out and gap opening stay', () => {
    assert.equal(dsCall(meters('blocked')).state, 'wheel');
    assert.equal(dsCall(meters('blocked'), [], {through: true}), null, 'ease off');
    assert.equal(dsCall(meters('blocked-left'), [], {through: true}), null, 'stuck alongside: drop back');
    assert.equal(dsCall(meters('clear', 'drop-back'), [], {through: true}), null, 'your pass: drop back');
    assert.equal(dsCall(meters('clear', 'rider-right'), [], {through: true}), null, 'being passed');
    assert.equal(dsCall(meters('clear'), [nudge('wheel')], {through: true}), null, 'the habit: ease off');
    assert.equal(dsCall(meters('step-left'), [], {through: true}).id, 'step');
    assert.equal(dsCall(meters('clear', 'too-slow'), [], {through: true}).state, 'too-slow', '"go harder" fits a move');
    assert.equal(dsCall(meters('clear', null, 'gapping'), [], {through: true}).id, 'gap');
    assert.ok(isHoldCall({id: 'blocked', state: 'wheel'}) && !isHoldCall({id: 'step', state: 'step-left'}));
    // the engine's reading: 1 km/h over your group is moving through
    assert.equal(THROUGH_KMH, 1);
    assert.equal(movingThrough({throughKmh: 1.2}), true);
    assert.equal(movingThrough({throughKmh: 0.5}), false);
    assert.equal(movingThrough({throughKmh: null}), false);
    assert.equal(engineCall(meters('blocked'), {throughKmh: 1.5}), null);
    assert.equal(engineCall(meters('blocked'), {throughKmh: 0.2}).id, 'blocked');
});

test('the split rows: step out, stuck alongside, group shattering are their own calls', () => {
    assert.deepEqual([dsCall(meters('step-right')).id, dsCall(meters('blocked-right')).id, dsCall(meters('blocked-right')).state],
        ['step', 'alongside', 'right']);
    assert.equal(dsCall(meters('clear', null, 'shatter')).id, 'shatter');
    for (const id of Object.keys(SPLIT_FROM)) assert.ok(CALL_TYPES.some(t => t.id === id), id);
    // your choices carry over: the new rows take what you had for the row they came out of
    const mine = deliveryDefaults({callBlockedChime: true, callBlockedVoice: true, callGapChime: false, callGapVoice: true});
    assert.deepEqual(deliveryFor(mine, 'step'), {chime: true, voice: true});
    assert.deepEqual(deliveryFor(mine, 'alongside'), {chime: true, voice: true});
    assert.deepEqual(deliveryFor(mine, 'shatter'), {chime: false, voice: true});
    // a fresh install: nothing that clashed with moving up is heard; step out is
    const fresh = deliveryDefaults({});
    for (const id of ['blocked', 'alongside', 'pass', 'passed', 'shatter']) assert.deepEqual(deliveryFor(fresh, id), {chime: false, voice: false}, id);
    assert.equal(deliveryFor(fresh, 'step').voice, true);
});

test('only calls you can hear compete: a silent one no longer holds back a lower one you hear', () => {
    const data = meters('blocked', null, 'gapping');                 // gap opening 75 over ease off 65
    assert.equal(dsCall(data).id, 'gap');
    assert.equal(dsCall(data, [], {audible: id => id !== 'gap'}).id, 'blocked');
    assert.equal(engineCalls(data, {}, id => id === 'blocked').main.id, 'blocked');
});

test('bends: their own lane, shown when nothing else is, and their own timing', () => {
    const data = meters('blocked');
    const both = engineCalls(data, {bend: {state: 'open', side: 'right', inS: 6}});
    assert.equal(both.main.id, 'blocked');
    assert.equal(engineCalls(meters('clear'), {}).bend, null);
    assert.equal(dsCall(data, [bend], {lane: 'main'}).id, 'blocked');
    assert.equal(dsCall(data, [bend], {lane: 'bend'}).id, 'bend');
    assert.equal(engineCall(meters('clear'), {bend: {state: 'open', side: 'right', inS: 6}})?.id, 'bend', 'shown when nothing else');
    // the lanes: a shared guard so they never talk over each other, each keeping its own gaps
    const guard = {lastAt: -Infinity};
    const main = new Announcer({guard}), lane = new Announcer({...BEND_LANE, guard});
    const on = {chime: true, voice: true};
    assert.ok(main.offer({id: 'gap', state: 'opening', word: 'gap opening'}, on, 0));
    assert.equal(lane.offer(bend, on, 1000), null, 'not over the call just said');
    assert.ok(lane.offer(bend, on, CROSS_GAP_S * 1000 + 10), 'then the bend');
    lane.offer(null, on, 4000);
    assert.equal(lane.offer(bend, on, 5000), null, 'the same bend not again within its repeat');
    assert.ok(lane.offer({...bend, state: 'open-left'}, on, 6100), 'the next bend: its own key, its own short gap');
    // the bends don't use up the main lane's 6 s or its type wait
    assert.ok(main.offer({id: 'blocked', state: 'wheel', word: 'ease off'}, on, 8700), 'main: 6 s after its own last call, bends or not');
});

test('the Wheel gap tile: red pushing into the wheel, green in the good seat, yellow too close or drifting off', () => {
    assert.equal(gapLevel(2.5, 'blocked'), 'alarm');
    assert.equal(gapLevel(0.4, 'step-left'), 'alarm');
    assert.equal(gapLevel(GAP_GOOD_M[0], 'clear'), 'good');
    assert.equal(gapLevel(3.5, 'clear'), 'good');
    assert.equal(gapLevel(0.6, 'clear'), 'warn');
    assert.equal(gapLevel(6, 'clear'), 'warn');
    assert.equal(gapLevel(1.5, 'clear'), null);
    assert.equal(gapLevel(null, 'blocked'), null, 'no wheel: no color');
    assert.equal(gapLevel(2.5, 'blocked-left'), 'good', 'stuck alongside is not pushing into the wheel ahead');
});

test('the engine: your speed over your group, averaged over 3 s, starting over when there is nothing to compare', () => {
    const e = new MeterEngine();
    assert.equal(THROUGH_S, 3);
    assert.equal(e.through(1000, 2), 2);
    assert.equal(e.through(2000, 0), 1);
    assert.equal(e.through(5500, 3), 3, 'older than 3 s: dropped');
    assert.equal(e.through(6000, null), null);
    assert.equal(e.through(7000, 1), 1, 'started over');
});
