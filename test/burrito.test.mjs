/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BurritoWatch, BURRITO} from '../pages/src/burrito.mjs';
import {directorCalls} from '../pages/src/ds-data.mjs';

const M = 113513;   // roadPosition units per meter
// me at gap 0; others at gapDistance (negative = ahead), side in meters, burrito active or not
const me = (held = null) => ({self: true, athleteId: 1, gapDistance: 0, state: {eventSubgroupId: 9, roadPosition: 0},
                              gameState: {availablePowerUp: held}});
const rider = (id, gap, side = 0, active = false, sg = 9) => ({athleteId: id, gapDistance: gap,
    state: {eventSubgroupId: sg, roadPosition: side * M, activePowerUp: active ? 'UNDRAFTABLE' : null}});

test('burritos: in play once you hold one (everyone got one in the pens); the ones still ahead of you counted', () => {
    const w = new BurritoWatch();
    const field = [rider(2, -20), rider(3, -10), rider(4, 15), rider(5, -40, 0, false, 8)];
    assert.equal(w.update(field, me(), 0), null, 'no burrito held, none fired: nothing');
    const r = w.update(field, me('UNDRAFTABLE'), 1000);
    assert.equal(r.state, 'ahead');
    assert.equal(r.unfiredAheadN, 2, 'two riders ahead; the one behind and the other race do not count');
    assert.equal(r.othersN, 3);
});

test('burritos: one fired just ahead of you = move over; off to the side or far ahead it is not you', () => {
    const w = new BurritoWatch();
    let r = w.update([rider(2, -8, 0.5, true), rider(3, -20)], me(), 0);
    assert.equal(r.state, 'cone');
    assert.ok(Math.abs(r.cone.aheadM - 8) < 1e-9);
    assert.equal(r.firedN, 1);
    assert.deepEqual(directorCalls({burrito: r}).find(c => c.id === 'burrito').word, 'burrito, move over');
    r = w.update([rider(2, -8, 4, true), rider(3, -20)], me(), 1000);
    assert.equal(r.state, 'ahead', 'four meters to the side: outside the cone');
    r = w.update([rider(2, -60, 0, true), rider(3, -20)], me(), 2000);
    assert.notEqual(r.state, 'cone', 'too far ahead');
    // 20 s after it was first seen, even if Sauce still shows it
    r = w.update([rider(2, -8, 0, true), rider(3, -20)], me(), (BURRITO.activeS + 3) * 1000);
    assert.notEqual(r.state, 'cone');
});

test('burritos: "burritos done" once nearly everyone has fired (for a few seconds), then quiet', () => {
    const w = new BurritoWatch();
    const many = Array.from({length: 10}, (_, i) => rider(10 + i, -100 - i * 5));
    w.update(many, me('UNDRAFTABLE'), 0);
    let r;
    for (let i = 0; i < 9; i++) r = w.update(many.map((x, k) => (k === i ? rider(x.athleteId, x.gapDistance, 0, true) : x)), me(), 1000 + i * 1000);
    assert.equal(r.firedN, 9);
    assert.equal(r.state, 'done', '9 of 10');
    assert.equal(directorCalls({burrito: r}).find(c => c.id === 'burrito').word, 'burritos done');
    r = w.update(many, me(), 9000 + (BURRITO.doneS + 1) * 1000);
    assert.equal(r.state, 'clear');
    assert.equal(w.update(many, {...me(), state: {eventSubgroupId: 0}}, 30000), null, 'out of the event');
});
