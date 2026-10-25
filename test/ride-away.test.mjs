/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RideAwayWatch, RIDE_AWAY} from '../pages/src/ride-away.mjs';

// riders ahead of you on your road: gapDistance (− = ahead) at each second, everyone's state at the same time
const tickOf = (t, aheads) => {
    const me = {athleteId: 'me', gapDistance: 0, state: {worldTime: t * 1000, speed: 36, roadId: 1, reverse: false}};
    return {me, entries: [me, ...aheads.map((d, i) => ({athleteId: `r${i}`, gapDistance: -d,
        state: {worldTime: t * 1000, speed: 36, roadId: 1, reverse: false}}))]};
};
const run = (secs, aheadAt, w = new RideAwayWatch(), from = 0) => {
    let r = null;
    for (let t = from; t <= secs; t++) {
        const {me, entries} = tickOf(t, aheadAt(t));
        r = w.update(entries, me, t * 1000);
    }
    return r;
};

test('ride away: a steady group says nothing; riders ahead drawing away is "away"', () => {
    assert.equal(run(15, () => [2, 4, 6, 8]), null);
    const away = run(15, t => [2, 4, 6, 8].map(d => d + 0.5 * t));
    assert.equal(away.state, 'away');
    assert.ok(Math.abs(away.mps - 0.5) < 1e-9);
    assert.equal(run(15, t => [2, 4].map(d => d + t)), null, `fewer than ${RIDE_AWAY.minRiders} riders: no reading`);
});

test('ride away: the front leaving while the rest stay is "shatter", held for a while after', () => {
    // 2026-10-25 start: the front riders 1+ m/s away, the ones near you not
    const w = new RideAwayWatch();
    assert.equal(run(12, t => [2, 3, 4, 5, 10 + 1.2 * t, 12 + 1.2 * t], w).state, 'shatter');
    // then everyone steady again: still "shatter" within holdS, gone after
    const steady = () => [2, 3, 4, 5, 24.4, 26.4];
    assert.equal(run(20, steady, w, 13).state, 'shatter', 'held');
    assert.equal(run(12 + RIDE_AWAY.holdS + 2, steady, w, 21), null);
});
