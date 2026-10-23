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

// ----- imported cards (a file from caffecter.com's race card maker, or written by hand) -----

const ownCard = (over = {}) => ({id: 'my-race-2026-11-03', name: 'My race', date: '2026-11-03', format: 'points',
    route: 'Watopia Flat Route', distanceKm: 10.3,
    items: [{km: 3.5, kind: 'sprint', name: 'Fuego Flats', lengthKm: 0.4, scored: true},
            {km: 10.3, kind: 'finish', name: 'Finish', scored: true}], ...over});

test('importing a card: checked like a shipped one, needs its route; the same id replaces the old one', async () => {
    const {importCard} = await import('../pages/src/race-cards-live.mjs');
    const [one, msg] = importCard(JSON.stringify(ownCard()), []);
    assert.equal(one.length, 1);
    assert.match(msg, /imported My race \(Watopia Flat Route\)/);
    const [two, msg2] = importCard(JSON.stringify(ownCard({name: 'My race, fixed'})), one);
    assert.equal(two.length, 1);
    assert.equal(two[0].name, 'My race, fixed');
    assert.match(msg2, /replaced/);
    assert.throws(() => importCard('{not json', []), /not JSON/);
    assert.throws(() => importCard(JSON.stringify(ownCard({route: undefined})), []), /no route/);
    assert.throws(() => importCard(JSON.stringify(ownCard({items: [{km: 1, kind: 'wall', name: 'x'}]})), []), /bad kind/);
});

test('an imported card is used on its route like a shipped one, after a refresh', async () => {
    let imported = [];
    const cards = new RaceCards({fetchJSON, routeName: async () => 'Watopia Flat Route', imported: () => imported});
    const s = edM => ({routeId: 2, eventDistance: edM, eventSubgroupId: 7});
    cards.call(s(3000));
    await settle();
    assert.equal(cards.call(s(3000)), null, 'no card for this route yet');
    imported = [ownCard()];
    cards.refresh();
    cards.call(s(3000));
    await settle();
    const c = cards.call(s(3000), {v: 11});
    assert.equal(c.item.name, 'Fuego Flats');
    assert.ok(Math.abs(c.toM - 500) < 1e-6);
});

test('the card list: shipped entries plus imported cards, each carrying its card', async () => {
    const {cardEntries, loadEntry} = await import('../pages/src/race-cards-live.mjs');
    const list = cardEntries([{id: 'a', name: 'A', route: 'R', file: 'a.json'}], [ownCard()]);
    assert.deepEqual(list.map(e => [e.id, !!e.imported]), [['a', false], ['my-race-2026-11-03', true]]);
    const card = await loadEntry(fetchJSON, list[1]);
    assert.deepEqual(card.items.map(i => i.km), [3.5, 10.3]);
    await assert.rejects(loadEntry(fetchJSON, cardEntries([], [ownCard({items: [{km: 'x', kind: 'sprint', name: 'bad'}]})])[0]), /bad km/);
});
