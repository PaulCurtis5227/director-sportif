/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SaveQueue, holdSaves, SAVE_STALE_S, OPEN_WAIT_S} from '../pages/src/save-queue.mjs';

test('no save window from the pen to the finish', () => {
    const now = 1_000_000;
    assert.equal(holdSaves({sg: 7, ended: false, lastTickMs: now - 1000, nowMs: now}), true, 'in the pen / racing');
    assert.equal(holdSaves({sg: 7, ended: true, lastTickMs: now - 1000, nowMs: now}), false, 'finished');
    assert.equal(holdSaves({sg: null, lastTickMs: now - 1000, nowMs: now}), false, 'free ride');
    assert.equal(holdSaves({sg: 7, lastTickMs: now - SAVE_STALE_S * 1000, nowMs: now}), false, 'Zwift gone');
    assert.equal(holdSaves({lastTickMs: 0, nowMs: now, openedMs: now - 1000}), true, 'just opened: wait for the first data');
    assert.equal(holdSaves({lastTickMs: 0, nowMs: now, openedMs: now - OPEN_WAIT_S * 1000}), false, 'no data at all');
});

test('the queue saves in order once let go, keeps what fails', async () => {
    const saved = [], done = [];
    const q = new SaveQueue((blob, name) => saved.push(name));
    q.add({name: 'warm-up', blob: async () => 'a', done: async () => done.push('warm-up')});
    q.add({name: 'bad', blob: async () => { throw new Error('gone'); }, done: async () => done.push('bad')});
    q.add({name: 'race', blob: async () => 'b', done: async () => done.push('race')});
    await q.run(true);
    assert.deepEqual(saved, [], 'held');
    const err = console.error;
    console.error = () => {};
    await q.run(false);
    console.error = err;
    assert.deepEqual(saved, ['warm-up', 'race']);
    assert.deepEqual(done, ['warm-up', 'race'], 'the failed one stays in the store');
    assert.equal(q.size, 0);
});
