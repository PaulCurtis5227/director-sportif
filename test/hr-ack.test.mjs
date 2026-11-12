/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {MeterEngine} from '../pages/src/meter-engine.mjs';
import {TEAM_HR} from '../pages/src/team-hr.mjs';

test('v0.63.1 (the user, 2026-11-09: "Said I didn\'t have a HR. Couldn\'t clear it"): "I know" reaches the watch the banner reads', () => {
    const engine = new MeterEngine();
    const kept = engine.teamHrWatch;   // what the window holds for "I know" (meters.mjs hrChecker)
    const me = s => ({athleteId: 388, self: true, watching: true, gapDistance: 0, athlete: {team: 'dinos'},
                      state: {athleteId: 388, eventSubgroupId: 7, worldTime: 1e9 + s * 1000, speed: 30, power: 150, heartrate: 0,
                              roadId: 1, roadCompletion: 1000 + s, courseId: 6}});
    for (let s = 0; s <= TEAM_HR.noneS + 2; s++) engine.update([me(s)]);
    assert.equal(engine.teamHrWatch, kept, 'the first tick (a new rider) must not swap the watch for a new one');
    // the engine runs it in races only (raceFor): fed here as it would be
    let before = null;
    for (let s = 0; s <= 30; s++) before = engine.teamHrWatch.update([me(s)], me(s), 1e9 + s * 1000);
    assert.equal(before.state, 'missing');
    kept.ack(388);
    const after = engine.teamHrWatch.update([me(31)], me(31), 1e9 + 31_000);
    assert.ok(after.missing.every(m => m.acked), 'acknowledged: the banner closes');
});
