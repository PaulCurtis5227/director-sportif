/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DropWatch, DROP} from '../pages/src/drop-watch.mjs';
import {dsCall} from '../pages/src/calls.mjs';
import {buildData} from '../pages/src/ds-data.mjs';

const st = (x = {}) => ({roadId: 3, reverse: false, speed: 33, worldTime: 0, eventSubgroupId: 7, ...x});
const at = (id, ahead, wt) => ({athleteId: id, gapDistance: -ahead, state: st({worldTime: wt})});
const meAt = wt => ({athleteId: 1, self: true, gapDistance: 0, state: st({worldTime: wt})});
// a group of 4 ahead of you: its rearmost rider gap(t) m up, the others 2 m apart
const ride = (w, from, to, gap) => {
    const out = [];
    for (let t = from; t <= to; t++) {
        const g = gap(t), me = meAt(t * 1000);
        out.push([t, w.update([me, at(2, g, t * 1000), at(3, g + 2, t * 1000), at(4, g + 4, t * 1000), at(5, g + 6, t * 1000)], me, t * 1000)]);
    }
    return out;
};

test('losing the group: a slow drift off the back (2026-11-06: 5 -> 32 m at ~0.5 m/s, no call then) is called once', () => {
    const w = new DropWatch();
    ride(w, 0, 20, () => 3);                                  // on the back of the group
    const drift = ride(w, 21, 80, t => 3 + 0.5 * (t - 20));   // 0.5 m/s: never "gap opening" (0.7 m/s over 10 s)
    const on = drift.filter(([, o]) => o);
    assert.ok(on.length, 'called');
    const [t0, first] = on[0];
    assert.ok(first.fresh && first.gapM >= DROP.minM && first.gapM < 15, JSON.stringify(first));
    assert.ok(t0 - 20 <= 25, `within 25 s of the drift: ${t0 - 20}`);
    // once per drift: on for DROP.onS, then quiet while the gap keeps growing
    assert.ok(on.every(([t]) => t - t0 <= DROP.onS), 'not repeated');
    // back on the group (rearmS), then a second drift is called again
    ride(w, 81, 120, () => 3);
    assert.ok(ride(w, 121, 180, t => 3 + 0.5 * (t - 120)).some(([, o]) => o && o.fresh), 'the next drift');
});

test('losing the group: a gap that stays small, a one-tick jump or one you are closing is no call', () => {
    const w = new DropWatch();
    ride(w, 0, 20, () => 3);
    assert.ok(ride(w, 21, 60, t => 3 + 4 * Math.abs(Math.sin(t / 5))).every(([, o]) => !o), 'yo-yo within 7 m');
    const j = new DropWatch();
    ride(j, 0, 20, () => 3);
    assert.ok(ride(j, 21, 40, t => (t === 30 ? 20 : 3)).every(([, o]) => !o), 'one tick at 20 m (a road with no map)');
    // fell back 12 m, now closing at 1 m/s: you are on it already
    const c = new DropWatch();
    ride(c, 0, 20, () => 3);
    const back = ride(c, 21, 50, t => (t <= 32 ? 3 + (t - 20) : 15 - (t - 32)));
    assert.ok(back.filter(([t]) => t >= 36).every(([, o]) => !o), 'closing it');
});

test('losing the group: called as the gap call, also once you are out of the group (alone)', () => {
    const data = buildData({me: {state: {}}, ds: {groupSize: 1, gapSource: 'road', positionState: 'dropping'}});
    assert.equal(data.meters.position.state, 'dropping');
    const c = dsCall(data);
    assert.equal(c.id, 'gap');
    assert.equal(c.state, 'dropping');
    assert.equal(c.word, 'losing group');
});
