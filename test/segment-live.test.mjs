/*
 * Director Sportif â€” a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Segment cards in a free ride, on a made-up straight road 10 km long: 1 km of it is 1% of the road.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SegmentCards, toBannerM, SEGMENT_ARM_M} from '../pages/src/segment-live.mjs';
import {RoadMap, metersAt} from '../pages/src/engine/road-map.mjs';
import {RaceCards} from '../pages/src/race-cards-live.mjs';

const N = 103, STEP_M = 100;
const path = Array.from({length: N}, (_, i) => [i * STEP_M * 100, 0, 0]);
const roadMap = new RoadMap(null);
roadMap.setRoads(6, [{id: 7, path}]);
const road = roadMap.road(6, 7);
const percentAt = m => (m - metersAt(road, 0)) / (metersAt(road, 1) - metersAt(road, 0));
const seg = {id: 'S1', courseId: 6, roadId: 7, reverse: false, roadStart: percentAt(5000), roadFinish: percentAt(5200), distance: 200};
const item = (over = {}) => ({km: 3.15, kind: 'sprint', name: 'Test Sprint', lengthKm: 0.2, scored: true, segmentId: 'S1',
                              pacing: {parts: [{atM: -175, say: 'go, 750'}]}, ...over});
const card = (id, over) => ({id, route: 'Some Other Route', items: [item(over)]});
const state = (m, over = {}) => ({courseId: 6, roadId: 7, reverse: false, roadCompletion: percentAt(m) * 1e6, worldTime: 1e9, eventSubgroupId: 0, ...over});
const settle = async () => { for (let k = 0; k < 8; k++) await new Promise(r => setTimeout(r, 0)); };

async function make(cards, opts = {}) {
    const passes = [];
    const sc = new SegmentCards({cards: () => cards, segment: async id => (id === 'S1' ? seg : null), roadMap, onPass: p => passes.push(`${p.kind}${p.uturn ? ' uturn' : ''}`), ...opts});
    sc.call(state(100));
    await settle();
    return {sc, passes};
}

test('meters to the banner: from the road, either way you face, past it below zero', () => {
    assert.ok(Math.abs(toBannerM(seg, road, state(4700)) - 300) < 1);
    assert.ok(Math.abs(toBannerM(seg, road, state(5100)) + 100) < 1);
    const rev = {...seg, reverse: true};
    assert.ok(Math.abs(toBannerM(rev, road, state(5100, {reverse: true, roadCompletion: (1 - percentAt(5100)) * 1e6})) - 100) < 1, 'a reverse segment runs the other way');
});

test('a free ride, any route: the same calls as a race, at the right place, timed by your own lead', async () => {
    const {sc} = await make([card('a')]);
    const v = 12;   // 43 km/h
    assert.equal(sc.call(state(2000), {v}), null, 'too far');
    const prep = sc.call(state(4750), {v});
    assert.equal(prep.about, 'pace');
    assert.equal(prep.say, 'go');
    assert.ok(Math.abs(prep.toM - 75) < 1, `${prep.toM}: 175 m out is 75 m ahead`);
    assert.equal(sc.call(state(4830), {v}).say, 'go, 750', 'at the spot');
    const early = sc.call(state(4815), {v, leadS: 1.5});
    assert.equal(early.say, 'go, 750', '18 m early: 1.5 s at 12 m/s');
    assert.notEqual(sc.call(state(4800), {v, leadS: 1.5}).say, 'go, 750', 'but not sooner');
});

test('a free-ride card stays out of a race and off other roads; skip says no', async () => {
    const plan = {[`3.15|Test Sprint`]: {plan: 'skip'}};
    const {sc} = await make([card('a')]);
    assert.equal(sc.call(state(4830, {eventSubgroupId: 9}), {v: 12}), null, 'an event: the race card does this');
    assert.equal(sc.call(state(4830, {roadId: 8}), {v: 12}), null);
    const no = await make([card('a')], {planFor: () => plan});
    assert.equal(no.sc.call(state(4830), {v: 12}), null);
    assert.deepEqual(no.passes, [], 'no pass, no recording');
});

test('a pass reports itself once: armed, banner, line; left alone it gives up', async () => {
    const {sc, passes} = await make([card('a')]);
    const ride = (m, wt = 1e9) => sc.call(state(m, {worldTime: wt}), {v: 12});
    ride(5000 - SEGMENT_ARM_M - 100);
    assert.deepEqual(passes, []);
    ride(5000 - SEGMENT_ARM_M + 10);
    ride(4900);
    assert.deepEqual(passes, ['arm']);
    ride(5010);
    ride(5100);
    assert.deepEqual(passes, ['arm', 'banner']);
    ride(5210);
    assert.deepEqual(passes, ['arm', 'banner', 'line']);
    ride(5300);
    ride(4600, 1e9 + 10000);
    ride(4600, 1e9 + 400000);
    assert.deepEqual(passes.slice(3), ['arm', 'abort']);
});

test('two cards for a segment: the normal one, or the U-turn one after a turn; the turn itself is called', async () => {
    const turn = {pacing: {parts: [{atM: -70, say: 'go, 700'}], uturn: {kmh: 24, topAtM: -35, turnAtM: -110}}};
    const {sc, passes} = await make([card('normal'), card('turn', turn)]);
    const v = 10;
    const plain = await make([card('normal'), card('turn', turn)]);
    assert.equal(plain.sc.call(state(4830), {v}).say, 'go, 750', 'no turn: the normal card');
    // the other way, from past the banner toward the spot, 110 m before it (road 4890)
    const back = (m, wt = 1e9) => sc.call(state(m, {reverse: true, roadCompletion: (1 - percentAt(m)) * 1e6, worldTime: wt}), {v, leadS: 1.5, turnLeadS: 2.5});
    const near = back(4990);
    assert.equal(near.say, 'U-turn');
    assert.ok(Math.abs(near.toM - 60) < 2, `${near.toM}: 100 m to go, less 4 s at 10 m/s`);
    assert.match(near.state, /uturn-prep/);
    assert.match(back(4925).state, /uturn$/, 'said 40 m early');
    assert.deepEqual(passes, ['arm uturn']);
    const after = sc.call(state(4935, {worldTime: 1e9 + 5000}), {v});
    assert.equal(after.say, 'go, 700', 'turned: the U-turn card');
    sc.turnedWt = 1e9 - 500000;
    assert.equal(sc.call(state(4830, {worldTime: 1e9}), {v}).say, 'go, 750', 'a turn long ago: the normal card');
});

test('no U-turn card, no call riding the other way; a card with no segmentId stays a race card', async () => {
    const {sc} = await make([card('a')]);
    assert.equal(sc.call(state(4990, {reverse: true, roadCompletion: (1 - percentAt(4990)) * 1e6}), {v: 10}), null);
    const old = await make([card('old', {segmentId: undefined})]);
    assert.equal(old.sc.call(state(4830), {v: 12}), null);
    const gone = await make([card('gone', {segmentId: 'nobody'})]);
    assert.equal(gone.sc.call(state(4830), {v: 12}), null, 'a segment Sauce doesn\'t know: silent');
});

// A standing start 600 m out; after go you're at 15 m/s at once (simple sums): 600, 585, 570… meters before the banner.
// The jump is 150 m out, the line 200 m past the banner: you want to pass riders between 150 and -200.
const TRACE = Array.from({length: 55}, (_, k) => 600 - 15 * k);
const standing = {pacing: {parts: [{atM: -150, say: 'go, 750'}], start: {waitAtM: -600, goS: 40, goW: 215, trace: TRACE}}};
const ahead = (dBefore, ms) => ({state: state(5000 - dBefore, {speed: ms * 3.6})});

test('a standing start: "stop" to the spot, then go when riding off passes the most riders in your sprint', async () => {
    const {sc, passes} = await make([card('normal'), card('stand', standing)]);
    // on the way: "stop in", then "stop" at the spot (road 4400 = 600 m out)
    const near = sc.call(state(4300), {v: 10});
    assert.equal(near.say, 'stop');
    assert.match(near.state, /stop-prep/);
    assert.equal(sc.call(state(4395), {v: 10}).say, 'stop');
    // stopped there, nobody around
    const quiet = sc.call(state(4400), {v: 0});
    assert.equal(quiet.say, 'go when ready');
    assert.match(quiet.text, /nobody around/);
    assert.deepEqual(passes, ['arm'], 'the pass starts on the spot (a recording)');
    // a rider 50 m ahead of you at 5 m/s: go now and you pass them before your jump; wait 49 s and it's at your jump
    const one = sc.call(state(4400), {v: 0, riders: [ahead(550, 5)]});
    assert.equal(one.say, 'wait');
    assert.ok(Math.abs(one.inS - 49) <= 1, `${one.inS}`);
    assert.match(one.text, /1 rider to catch/);
    // a rider 300 m out at 5 m/s: going now passes them in the sprint
    assert.equal(sc.call(state(4400), {v: 0, riders: [ahead(300, 5)]}).say, 'go, 220');
});

test('a standing start waits for the moment that passes the most, not the first one, and only riders you can catch', async () => {
    const {sc} = await make([card('stand', standing)]);
    sc.call(state(4400), {v: 0});
    // 300 and 320 m out at 5 m/s: now catches only the first in the sprint; 3 s from now catches both
    const two = sc.call(state(4400), {v: 0, riders: [ahead(300, 5), ahead(320, 5)]});
    assert.equal(two.say, 'go');
    assert.ok(Math.abs(two.inS - 3) <= 1, `${two.inS}`);
    assert.match(two.text, /2 riders/);
    // your lead comes off it
    assert.ok(Math.abs(sc.call(state(4400), {v: 0, leadS: 1.5, riders: [ahead(300, 5), ahead(320, 5)]}).inS - 1.5) <= 1);
    // faster than you, the other way, or stopped: nobody to catch
    const none = sc.call(state(4400), {v: 0, riders: [ahead(400, 20), {state: state(4700, {speed: 18, reverse: true})}, ahead(300, 0)]});
    assert.equal(none.say, 'go when ready');
    assert.match(none.text, /nobody to catch in the sprint/);
});

test('a standing start: after go, the card\'s own plan; no waiting again on that pass', async () => {
    const {sc} = await make([card('stand', standing)]);
    sc.call(state(4400), {v: 0});
    assert.equal(sc.call(state(4400), {v: 0, riders: [ahead(300, 5)]}).say, 'go, 220');
    assert.equal(sc.call(state(4855), {v: 11}).say, 'go, 750');
    assert.notEqual(sc.call(state(4400), {v: 0})?.say, 'go when ready', 'gone: no waiting again on this pass');
});

test('RaceCards hands a free ride to the segment cards, with your lead times, and a race stays by race distance', async () => {
    const {sc} = await make([card('a')]);
    const cards = new RaceCards({fetchJSON: async () => ({cards: []}), routeName: async () => 'x', segments: sc, leads: () => ({leadS: 1.5, turnLeadS: 2.5})});
    assert.equal(cards.call(state(4815), {v: 12}).say, 'go, 750');
    cards.refresh();
    assert.equal(sc.entries, null, 'an import or a removal looks again');
});
