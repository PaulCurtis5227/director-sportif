/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * v0.67.2 (2026-11-15 video: "move right in 10, 10, 8, 7, 6, 4, 4, 4, 4", then gone in the bend): a held countdown keeps
 * counting, a called bend counts to its start, "right in 3" once its job is done.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {allWords} from '../pages/src/grid-fields.mjs';
import {directorCalls} from '../pages/src/ds-data.mjs';
import {distanceAlong} from '../pages/src/meter-engine.mjs';

const call = {id: 'bend', state: 'open-right', word: 'move right', in: 4, for: null, priority: 45};

test('a held countdown keeps counting, then goes once it runs out', () => {
    const hold = new Map();
    assert.equal(allWords({ts: 0, call}, hold).text, 'move right in 4');
    assert.equal(allWords({ts: 1000}, hold).text, 'move right in 3');
    assert.equal(allWords({ts: 2600}, hold).text, 'move right in 1');   // 1.4 left
    assert.equal(allWords({ts: 3000}, hold).text, 'move right in 1');   // 1.0 left, the hold's last moment
    assert.equal(allWords({ts: 3100}, hold).text, null);                // the hold's 3 s are over
});

test('a held countdown under the hold time ends at 0, not after the hold', () => {
    const hold = new Map();
    allWords({ts: 0, call: {...call, in: 2}}, hold);
    assert.equal(allWords({ts: 1000}, hold).text, 'move right in 1');
    assert.equal(allWords({ts: 1600}, hold).text, null);   // 0.4 left
});

test('a word without seconds is held as before', () => {
    const hold = new Map();
    allWords({ts: 0, call: {...call, word: 'move up', in: null, state: 'go'}}, hold);
    assert.equal(allWords({ts: 2500}, hold).text, 'move up');
});

test('a bend whose job is done counts on as "right in N"', () => {
    const c = directorCalls({bend: {state: 'open', side: 'right', inS: 3.2, done: true}}).find(x => x.id === 'bend');
    assert.equal(c.word, 'right');
    assert.equal(c.state, 'open-right');   // same state as "move right": not said again
    assert.equal(c.in, 3);
    assert.equal(directorCalls({bend: {state: 'open', side: 'left', inS: 6}}).find(x => x.id === 'bend').word, 'left');
});

test('distanceAlong: a point on the road ahead, projected between the points', () => {
    const pts = [0, 5, 10, 15, 20].map(d => ({d, xy: [d * 100, 0]}));
    assert.equal(distanceAlong(pts, [1230, 300]), 12.3);
    assert.equal(distanceAlong(pts, [1230, 2000]), null);   // 20 m to the side: not this road
    assert.equal(distanceAlong(pts, null), null);
    assert.equal(distanceAlong([], [0, 0]), null);
});

test('ServerClock: Zwift time from your states, the freshest over the last minute', async () => {
    const {ServerClock, WORLD_EPOCH_MS} = await import('../pages/src/join-watch.mjs');
    const c = new ServerClock();
    assert.equal(c.offsetMs(), 0);   // nothing seen: the PC clock
    const pc = 1794747566172;
    // the PC 1 s behind; states 0–0.4 s old when they arrive
    for (const [i, age] of [[0, 400], [1, 100], [2, 250]]) c.observe(pc + i * 1000 + 1000 - age - WORLD_EPOCH_MS, pc + i * 1000);
    assert.equal(c.offsetMs(), 900);
    assert.equal(c.now(pc), pc + 900);
    c.observe(pc + 70000 + 1000 - 300 - WORLD_EPOCH_MS, pc + 70000);   // a minute on: the old samples go
    assert.equal(c.offsetMs(), 700);
    c.observe(Number.NaN, pc + 71000);
    c.observe(pc + 3600000 - WORLD_EPOCH_MS, pc + 71000);            // an hour off: bad data, ignored
    assert.equal(c.offsetMs(), 700);
});
