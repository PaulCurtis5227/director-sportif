/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {dsCall, Announcer} from '../pages/src/calls.mjs';
import {directorCalls} from '../pages/src/ds-data.mjs';

test('finale (2026-10-25): the run-in speaks only finish, power-up, card and gap calls; after the jump only the finish; past the line nothing', () => {
    const data = {meters: {blocked: {state: 'blocked'}, passing: {state: 'drop-back'}, position: {state: 'gapping'}}};
    const sprint = {id: 'sprint', state: 'position', word: 'top ten', priority: 60};
    const surface = {id: 'surface', state: 'wood', word: 'wood', priority: 20};
    assert.equal(dsCall(data, [sprint, surface]).id, 'gap', 'not the finale: the highest priority');
    assert.equal(dsCall(data, [sprint, surface], {finale: 'run-in'}).id, 'gap');
    assert.equal(dsCall({meters: {blocked: {state: 'blocked'}}}, [sprint, surface], {finale: 'run-in'}).id, 'sprint', 'no "ease off"');
    assert.equal(dsCall(data, [sprint, surface], {finale: 'sprint'}).id, 'sprint', 'after the jump: no "gap opening"');
    assert.equal(dsCall({meters: {}}, [surface], {finale: 'run-in'}), null, 'no surface call');
    assert.equal(dsCall(data, [sprint], {finale: 'done'}), null, 'past the line');
});

test('announcer (2026-10-25): finish calls follow each other; the same one still waits', () => {
    const a = new Announcer();
    const d = {voice: true, chime: false};
    const c = (state, word) => ({id: 'sprint', state, word});
    assert.ok(a.offer(c('window-prep', 'jump'), d, 0));
    assert.ok(a.offer(c('window', 'you can go'), d, 10_000), 'another finish call 10 s later');
    assert.equal(a.offer(null, d, 11_000), null);
    assert.equal(a.offer(c('window', 'you can go'), d, 20_000), null, 'the same call again within the repeat time');
    const p = st => ({id: 'pass', state: st, word: 'drop back'});
    assert.ok(a.offer(p('drop-back'), d, 30_000));
    assert.equal(a.offer(p('too-slow'), d, 40_000), null, 'other types still wait as a type');
});

test('"jump in 20": the countdown to the sprint window, with its seconds', () => {
    const [c] = directorCalls({sprint: {state: 'window-prep', priority: 86, inS: 21.6, toLineS: 50}});
    assert.equal(c.word, 'jump');
    assert.equal(c.in, 20);
});

test('group shattering (2026-10-25) is a gap call', () => {
    const c = dsCall({meters: {position: {state: 'shatter'}}});
    assert.equal(c.id, 'gap');
    assert.equal(c.word, 'group shattering');
});
