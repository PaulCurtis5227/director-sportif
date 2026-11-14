/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {FlyerWatch, FLYER, flyerWord} from '../pages/src/flyer.mjs';
import {leads} from '../pages/src/engine/wheels.mjs';
import {directorCalls} from '../pages/src/ds-data.mjs';

/*
 * A bunch of 6 at 40 km/h, 2 m apart, you at the back; rider 99 at the front, `jump(s)` meters ahead of the next rider
 * (in line at 2 m when it's 0) at `kmh(s)`. gapDistance: negative = ahead of you.
 */
const V = 40;
function tick(s, {jump = () => 0, kmh = () => V, swing = null} = {}) {
    const st = (id, d, k = V) => ({athleteId: id, gapDistance: -d,
        state: {athleteId: id, worldTime: 1e9 + s * 1000, speed: k, roadId: 5, reverse: false, eventSubgroupId: 9}});
    const entries = [{...st(1, 0), self: true, watching: true}];
    for (let i = 1; i <= 4; i++) entries.push(st(10 + i, i * 2, swing && i === 4 ? swing(s) : V));
    entries.push(st(99, 10 + jump(s), kmh(s)));
    return {entries, me: entries[0], wt: 1e9 + s * 1000, lead: leads(entries), inEvent: true};
}

test('v0.66.0 (the user, 2026-11-11: "give enough warning so that with some effort you can catch the wheel"): said as they jump, under a second up', () => {
    const w = new FlyerWatch();
    let said = null;
    // from s = 5 the front rider goes 6 km/h faster (+1.7 m/s)
    for (let s = 0; s <= 20 && !said; s++) {
        const out = w.update(tick(s, {jump: t => Math.max(0, t - 5) * 1.7, kmh: t => (t >= 5 ? V + 6 : V)}));
        if (out && out.isNew) said = {s, ...out};
    }
    assert.ok(said, 'called');
    assert.ok(said.s <= 9, `within 4 s of the jump: ${said.s}`);
    assert.ok(said.gapS <= FLYER.maxS, `still catchable: ${said.gapS} s up`);
    assert.equal(flyerWord(said), 'flyer, go');
    assert.equal(directorCalls({flyer: {...said, say: true}}).find(c => c.id === 'flyer').word, 'flyer, go');
});

test('not a flyer: a turn at the front (the one swinging off slows), a rider already gone, outside an event', () => {
    // the front rider holds the bunch's speed while the second one drifts back: the gap grows, but nobody jumped
    const turn = new FlyerWatch();
    let any = false;
    for (let s = 0; s <= 20; s++) any = turn.update(tick(s, {jump: t => t * 0.6, kmh: () => V, swing: t => V - 3})) || any;
    assert.equal(any, false, 'a turn at the front');
    const gone = new FlyerWatch();
    any = false;
    for (let s = 0; s <= 20; s++) any = gone.update(tick(s, {jump: t => 40 + t * 1.7, kmh: () => V + 6})) || any;
    assert.equal(any, false, '4 s up and more: too late to say');
    const notEvent = new FlyerWatch();
    any = false;
    for (let s = 0; s <= 20; s++) any = notEvent.update({...tick(s, {jump: t => Math.max(0, t - 5) * 1.7, kmh: t => (t >= 5 ? V + 6 : V)}), inEvent: false}) || any;
    assert.equal(any, false);
});

test('your own attack is no flyer (2026-11-13 ToW stage 2: "flyer, away" while you went off the front of 15)', () => {
    const w = new FlyerWatch();
    let any = null;
    // you are the rider at the front who jumps: the others in line behind you, you going away 3.5 km/h faster
    for (let s = 0; s <= 20; s++) {
        const t = tick(s);
        const me = t.entries[0], d = Math.max(0, s - 5) * 1.0;   // 3.5 km/h faster: about 1 m/s
        me.gapDistance = 0;
        me.state.speed = s >= 5 ? V + 3.5 : V;
        // the others: in line behind you, 1 m apart, starting 2 m back plus the gap you opened
        t.entries.slice(1).forEach((o, i) => { o.gapDistance = 2 + d + i; o.state.speed = V; });
        any = w.update({...t, lead: leads(t.entries)}) || any;
    }
    assert.equal(any, null, 'never called for yourself');
});
