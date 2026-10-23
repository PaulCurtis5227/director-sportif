/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {RaceCards} from '../pages/src/race-cards-live.mjs';
import {directorCalls} from '../pages/src/ds-data.mjs';
import {dsCall} from '../pages/src/calls.mjs';

// the shipped cards, read from disk as the window fetches them
const fetchJSON = async url => JSON.parse(fs.readFileSync(fileURLToPath(url), 'utf8'));
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let k = 0; k < 6; k++) await tick(); };

test('the card for the route you race, picked by itself; silent off its route and outside an event', async () => {
    const names = {1: 'Urumaze', 2: 'Watopia Flat Route'};
    const cards = new RaceCards({fetchJSON, routeName: async id => names[id]});
    const s = (routeId, edM, sg = 7) => ({routeId, eventDistance: edM, eventSubgroupId: sg});
    assert.equal(cards.call(s(1, 7300)), null, 'loading');
    await settle();
    const c = cards.call(s(1, 7300), {v: 11});   // Tower Sprint at 7.7 km: 400 m ahead
    assert.equal(c.about, 'segment');
    assert.equal(c.item.name, 'Tower Sprint');
    assert.ok(Math.abs(c.toM - 400) < 1e-6);
    assert.equal(cards.call(s(1, 7300, 0)), null, 'not in an event');
    assert.equal(cards.call(s(2, 7300)), null, 'another route: loading');
    await settle();
    assert.equal(cards.call(s(2, 7300)), null, 'no card for that route');
});

test('card calls in words, with seconds; your plan and the power-up you hold', async () => {
    const cards = new RaceCards({fetchJSON, routeName: async () => 'Urumaze',
                                 planFor: () => ({'15|Tidepool Sprint Reverse': {plan: 'position'}, '9.3|Castle to Castle virtual arch': {power: 'keep'}})});
    const s = edM => ({routeId: 1, eventDistance: edM, eventSubgroupId: 7});
    cards.call(s(0));
    await settle();
    const word = (edM, held = null) => {
        const c = cards.call(s(edM), {v: 11, held});
        return directorCalls({card: {about: c.about, kind: c.item.kind, plan: c.plan, power: c.power, held: c.held,
                                     note: c.note, inS: c.toM / 11, endS: c.toEndM / 11, priority: c.priority, state: c.state}})[0];
    };
    assert.deepEqual([word(7300).word, word(7300).in], ['sprint', 35], 'Tower Sprint 400 m ahead at 11 m/s');
    assert.equal(word(7800).word, 'sprint line', 'inside it: to the line');
    assert.equal(word(14800).word, 'position', 'your plan for the second Tidepool');
    assert.equal(word(9000, 'DRAFTBOOST').word, 'keep VAN', 'your plan at the Castle arch: keep what you hold');
    for (const edM of [7300, 7800, 14800]) assert.ok(word(edM).word.length <= 12);
    // a scored segment ahead (contest, 75) outranks a rider creeping up (60)
    const c = cards.call(s(7300), {v: 11});
    const call = dsCall({meters: {passing: {value: 2, state: 'rider-left'}}},
        directorCalls({card: {about: c.about, kind: c.item.kind, plan: c.plan, inS: 36, priority: c.priority, state: c.state}}));
    assert.equal(call.id, 'card');
});
