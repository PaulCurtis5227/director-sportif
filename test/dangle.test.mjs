/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DangleWatch, DANGLE} from '../pages/src/dangle.mjs';
import {gapLevel} from '../pages/src/ds-data.mjs';

// a tick a second: last of 10 at 41 km/h in an event, the wheel `gapM` center to center
const tick = (s, gapM, over = {}) => ({wt: 1e9 + s * 1000, inEvent: true, settling: false, draftless: false, groupSize: 10,
                                      groupAhead: 9, gapM, kmh: 41, ...over});

test('v0.61.0 (the user, 2026-11-09: "dangling off the back a bit"): last of the group, the wheel 5.5 m+ off for 3 s: close up', () => {
    const w = new DangleWatch();
    const seen = [3, 4, 5.6, 5.8, 6, 6.2, 6.5, 6.8].map((g, i) => w.update(tick(i, g)));
    assert.deepEqual(seen, [false, false, false, false, false, true, true, true], `on at ${DANGLE.holdS} s past ${DANGLE.minM} m`);
    assert.equal(w.update(tick(8, 6.4)), true, 'still on while closing: the call stands till you are back');
    assert.equal(w.update(tick(9, 5)), false, 'back under 5.5 m: over');
    // once per dangle: not again until 10 s back within 4 m
    for (let i = 10; i < 15; i++) w.update(tick(i, 6));
    assert.equal(w.update(tick(15, 6)), false, 'not re-armed yet');
    for (let i = 16; i < 28; i++) w.update(tick(i, 3));
    for (let i = 28; i < 32; i++) w.update(tick(i, 6));
    assert.equal(w.update(tick(32, 6.2)), true, 're-armed after 10 s back on the wheel');
});

test('not when: in the middle of the group, slow, outside an event, settling, no draft, or already closing', () => {
    const run = over => {
        const w = new DangleWatch();
        let on = false;
        for (let i = 0; i < 8; i++) on = w.update(tick(i, 7, over));
        return on;
    };
    assert.equal(run({}), true);
    assert.equal(run({groupAhead: 5}), false, 'riders behind you in the group');
    assert.equal(run({kmh: 25}), false, 'a slow climb: gaps mean less');
    assert.equal(run({inEvent: false}), false);
    assert.equal(run({settling: true}), false);
    assert.equal(run({draftless: true}), false);
    assert.equal(run({groupSize: 2, groupAhead: 1}), false, 'a pair');
    const w = new DangleWatch();
    let on = false;
    for (let i = 0; i < 8; i++) on = w.update(tick(i, 12 - i));   // closing 1 m/s
    assert.equal(on, false, 'closing it already: no call');
});

test('the Wheel gap turns red when off the back or dangling', () => {
    assert.equal(gapLevel(4, null, 'off-back'), 'alarm');
    assert.equal(gapLevel(4, null, 'good'), null);
    assert.equal(gapLevel(2.5, null, null), 'good');
});
