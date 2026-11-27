/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressLeft, PROGRESS_LEFT} from '../pages/src/progress-left.mjs';

// a 54,144 m event: progress in steps of 1/255 of it, as Zwift sends it (2026-10-31)
const LEN = 54144;
const me = (ed, extra = {}) => ({self: true, remaining: null, remainingType: 'event', remainingMetric: 'distance',
    state: {eventSubgroupId: 7, eventDistance: ed, progress: Math.floor(ed / LEN * 255) / 255}, ...extra});

test('progress left: the event length from Zwift\'s progress steps when Sauce has no remaining', () => {
    const pl = new ProgressLeft();
    let r = null;
    for (let ed = 0; ed <= LEN - 1000; ed += 10) r = pl.fill(me(ed));
    assert.equal(r.remainingEst, true);
    assert.ok(Math.abs(r.remaining - 1000) < 220, `${r.remaining} m left, within one step`);
    // early on: no estimate
    const early = new ProgressLeft();
    for (let ed = 0; ed <= LEN * PROGRESS_LEFT.minProgress * 0.9; ed += 10) r = early.fill(me(ed));
    assert.equal(r.remaining, null);
});

test('progress left: Sauce\'s own remaining wins; a lap race counts too (progress is the whole event, 2026-11-26)', () => {
    const run = (extra = {}) => {
        const pl = new ProgressLeft();
        let r = null;
        for (let ed = 0; ed <= LEN / 2; ed += 50) {
            const m = me(ed, extra);
            r = pl.fill({...m, state: {...m.state, laps: Math.floor(ed / 3600)}});
        }
        return r;
    };
    assert.equal(run({remaining: 1234}).remaining, 1234);
    assert.equal(run().remainingEst, true, 'several laps');
    assert.ok(Math.abs(run().remaining - LEN / 2) < 220);
});

test('progress left: progress that falls (a count per lap) drops the estimate', () => {
    const pl = new ProgressLeft();
    let r = null;
    for (let ed = 0; ed <= 10000; ed += 50) r = pl.fill(me(ed));
    assert.equal(r.remainingEst, true);
    const m = me(10050);
    r = pl.fill({...m, state: {...m.state, progress: 0.01}});
    assert.equal(r.remaining, null);
});
