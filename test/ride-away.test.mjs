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

test('ride away: easing 3 m off the wheel in 10 s is not "away"; nor is one update of it (2026-10-31, 3 marks)', () => {
    assert.equal(run(15, t => [2, 4, 6, 8].map(d => d + 0.3 * Math.min(t, 10))), null, 'giving the wheel room');
    // one update with the riders 6 m further (a lead that settles back next second)
    assert.equal(run(12, t => [2, 4, 6, 8].map(d => d + (t === 12 ? 6 : 0))), null, 'seen once');
});

test('ride away: the front leaving while the rest stay is "shatter", held for a while after', () => {
    // 2026-10-25 start: the wheels just ahead of you go with the front, 1+ m/s away, the others don't
    const w = new RideAwayWatch();
    assert.equal(run(12, t => [2, 3, 4, 5, 1 + 1.2 * t, 1.5 + 1.2 * t], w).state, 'shatter');
    // then everyone steady again: still "shatter" within holdS, gone after
    const steady = () => [2, 3, 4, 5, 15.4, 15.9];
    assert.equal(run(20, steady, w, 13).state, 'shatter', 'held');
    assert.equal(run(12 + RIDE_AWAY.holdS + 2, steady, w, 21), null);
});

// riders with their own speeds (km/h): [lead at t, speed] per rider
const tickV = (t, riders) => {
    const me = {athleteId: 'me', gapDistance: 0, state: {worldTime: t * 1000, speed: 33, roadId: 1, reverse: false}};
    return {me, entries: [me, ...riders.map(([d, kmh], i) => ({athleteId: `r${i}`, gapDistance: -d,
        state: {worldTime: t * 1000, speed: kmh, roadId: 1, reverse: false}}))]};
};

test('ride away: one rider coming past plus a lone rider up the road is not a shatter (2026-10-29, a line of 5)', () => {
    const w = new RideAwayWatch();
    let r = null;
    for (let t = 0; t <= 15; t++) {
        // three steady wheels, one rider passing at +0.85 m/s, one rider 30 m up drifting off at 0.65 m/s
        const {me, entries} = tickV(t, [[2.3, 33], [5.2, 33], [8.0, 33], [1.3 + 0.85 * t, 36.1], [30 + 0.65 * t, 35.3]]);
        r = w.update(entries, me, t * 1000);
    }
    assert.equal(r, null);
});

test('ride away: a lead that jumps beyond the riders\' speeds is a data jump, not riders leaving', () => {
    const w = new RideAwayWatch();
    let r = null;
    for (let t = 0; t <= 15; t++) {
        // everyone at your speed; at t = 5 two of them jump 35 m up the road (the gaps switching source, as at 8:02)
        const jump = t >= 5 ? 35 : 0;
        const {me, entries} = tickV(t, [[2, 33], [3, 33], [4, 33], [5, 33], [6 + jump, 33], [6.5 + jump, 33]]);
        r = w.update(entries, me, t * 1000);
    }
    assert.equal(r, null);
});

test('ride away: two or more riders leaving at their real speed is still a shatter', () => {
    const w = new RideAwayWatch();
    let r = null;
    for (let t = 0; t <= 12; t++) {
        const {me, entries} = tickV(t, [[2, 33], [3, 33], [4, 33], [5, 33], [1 + 1.2 * t, 37.3], [1.5 + 1.2 * t, 37.3]]);
        r = w.update(entries, me, t * 1000);
    }
    assert.equal(r && r.state, 'shatter');
});

// a bunch of 20 ahead: lead per rider at t (s) for the 10-31 cases
const bunch20 = t => Array.from({length: 20}, (_, i) => 1 + i * 1.5);

test('ride away: two of 20 riders moving up the side is churn, not a shatter (2026-10-31 9:30)', () => {
    const w = new RideAwayWatch();
    let r = null;
    for (let t = 0; t <= 15; t++) {
        const riders = bunch20(t).map((d, i) => (i < 2 ? [d + 1.2 * t, 37.3] : [d, 33]));
        const {me, entries} = tickV(t, riders);
        r = w.update(entries, me, t * 1000);
    }
    assert.ok(!r || r.state !== 'shatter', `fewer than ${RIDE_AWAY.leaveShare * 100}% leaving`);
});

test('ride away: the front of a long bunch drawing out 20+ m up is not your group breaking (2026-10-31 13:50)', () => {
    const w = new RideAwayWatch();
    let r = null;
    for (let t = 0; t <= 15; t++) {
        // 12 riders 2–15 m up stay; 8 riders from 16 m up leave at 1 m/s
        const riders = [...Array.from({length: 12}, (_, i) => [2 + i, 33]), ...Array.from({length: 8}, (_, i) => [16 + 2 * i + t, 36.6])];
        const {me, entries} = tickV(t, riders);
        r = w.update(entries, me, t * 1000);
    }
    assert.ok(!r || r.state !== 'shatter', `the nearest leaving rider beyond ${RIDE_AWAY.splitNearM} m`);
});

test('ride away: split signs seen once (one update) are noise; seen twice within the window is a shatter', () => {
    // 2026-10-31: every one of 12 calls was a single update; the riders ahead swing together tick to tick
    const w = new RideAwayWatch();
    const at = (t, split) => [2, 3, 4, 5, ...(split ? [1 + 1.2 * 10, 1.5 + 1.2 * 10] : [1, 1.5])];
    let r = null;
    for (let t = 0; t <= 14; t++) {
        const {me, entries} = tickOf(t, at(t, t === 10));
        r = w.update(entries, me, t * 1000);
        if (t === 10) assert.ok(!r || r.state !== 'shatter', 'once: nothing yet');
    }
});
