/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * v0.64.0 (PLAN §24 step 3): the race promised to caffecter.com: the OBS title card says "In this race? Get your free
 * report" only then, and the send queue's give-up words reach the window (the reminder).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {titleQuery, parseTitleQuery} from '../pages/src/engine/title-card.mjs';
import {RideSender, memorySendStore} from '../pages/src/ride-sender.mjs';

test('the title card: "In this race? Get your free report" only for a promised race', () => {
    assert.equal(parseTitleQuery(titleQuery({eventName: 'Race', keep: true})).keep, true);
    assert.equal(parseTitleQuery(titleQuery({eventName: 'Race'})).keep, false);
    assert.equal(parseTitleQuery('?keep=yes').keep, false);
});

test('the send queue tells the window when it can\'t send (the promise reminder), as well as the settings tab', async () => {
    const seen = [];
    const m = new Map();
    const storage = {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)};
    const store = memorySendStore();
    await store.putRide({ride: 'c'.repeat(32), site: 'www', send: true, count: 2, createdAt: 1});
    const s = new RideSender({store, storage, fetch: async () => assert.fail('not linked: no call'), setTimeout: () => {},
                              onStatus: st => seen.push(st.text)});
    await s.kick();
    assert.equal(seen.length, 1);
    assert.match(seen[0], /not linked/);
});
