/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeWatch, BRIDGE} from '../pages/src/bridge.mjs';

// riders ahead of you: [lead (m), id] at second t, everyone's state at the same time
const tick = (t, riders) => {
    const me = {athleteId: 'me', gapDistance: 0, state: {worldTime: t * 1000, speed: 40, roadId: 1, reverse: false}};
    return {me, entries: [me, ...riders.map(([d, id]) => ({athleteId: id, gapDistance: -d,
        state: {worldTime: t * 1000, speed: 40, roadId: 1, reverse: false}}))]};
};
const run = (secs, at) => {
    const w = new BridgeWatch();
    let r = null;
    for (let t = 0; t <= secs; t++) { const {me, entries} = tick(t, at(t)); r = w.update(entries, me, t * 1000); }
    return r;
};

test('bridge: on a wheel you caught, closing on riders 30 m up the road', () => {
    // 2026-10-31: one rider caught (2 m), three more up the road coming back at 0.8 m/s
    const r = run(12, t => [[2, 'w'], [40 - 0.8 * t, 'a'], [42 - 0.8 * t, 'b'], [44 - 0.8 * t, 'c']]);
    assert.ok(r && r.closing, 'bridging');
    assert.equal(r.riders, 3);
    assert.ok(Math.abs(r.closeMps - 0.8) < 1e-9);
    assert.ok(Math.abs(r.aheadM - 30.4) < 1e-9);
});

test('bridge: not when they hold their gap, nor when the hole is far up a bunch', () => {
    const held = run(12, () => [[2, 'w'], [30, 'a'], [32, 'b']]);
    assert.equal(held.closing, false, 'not closing');
    assert.equal(held.closeMps, 0);
    assert.equal(held.aheadM, 30);
    // a line of riders every 2 m up to 20 m, then a hole: the hole starts beyond holeFromM of you
    const line = Array.from({length: 10}, (_, i) => [2 + 2 * i, `l${i}`]);
    assert.equal(run(12, t => [...line, [60 - t, 'a'], [62 - t, 'b']]), null, `the hole starts > ${BRIDGE.holeFromM} m up`);
});
