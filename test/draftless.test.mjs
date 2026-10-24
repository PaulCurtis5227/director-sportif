/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftlessWatch, DRAFTLESS_S} from '../pages/src/draftless.mjs';
import {buildData, directorCalls} from '../pages/src/ds-data.mjs';
import {engineCall} from '../pages/src/calls.mjs';

const feed = (w, secs, tick, t0 = 0) => {
    let r;
    for (let i = 0; i < secs; i++) r = w.update({wt: (t0 + i) * 1000, ...tick});
    return r;
};

test('no draft on a wheel for 20 s: you get none; any draft brings the pack back at once', () => {
    const w = new DraftlessWatch();
    assert.equal(feed(w, DRAFTLESS_S - 2, {draft: 0, gapM: 2}), false, 'not yet');
    assert.equal(feed(w, 4, {draft: 0, gapM: 2}, 100), true, 'a TT bike on a wheel');
    assert.equal(w.update({wt: 200000, draft: 40, gapM: 2}), false, 'draft again');
});

test('only on a wheel close ahead that gives draft: alone, far back or behind a burrito proves nothing', () => {
    const w = new DraftlessWatch();
    assert.equal(feed(w, 60, {draft: 0, gapM: null}), false, 'nobody ahead');
    assert.equal(feed(w, 60, {draft: 0, gapM: 15}, 100), false, 'too far back');
    assert.equal(feed(w, 60, {draft: 0, gapM: 2, noDraftWheel: true}, 200), false, 'that wheel gives no draft to anyone');
});

test('draftless: the pack meters read draftless (not the no-draft wheel), no pack calls, no move up / habits / wheel calls; the rest stay', () => {
    const me = {self: true, state: {power: 250, speed: 40, draft: 0, grade: 0}};
    const ds = {groupSize: 6, draftless: true, positionW: 30, positionState: 'gapping', blocked: true, blockedW: 40,
                passKind: 'defend', passWhere: 'behind', packW: 20, holdingW: 30,
                moveUp: {state: 'move', priority: 80}, nudge: {state: 'line', priority: 30},
                sprint: {state: 'windup', priority: 90}, pacing: {state: 'steep', inS: 20, forS: 30}};
    const d = buildData({me, ds});
    for (const k of ['position', 'holding', 'pack', 'blocked', 'passing']) {
        assert.equal(d.meters[k].state, 'draftless', k);
        assert.equal(d.meters[k].level, null, `${k}: no level`);
    }
    assert.deepEqual(directorCalls(ds).map(c => c.id), ['pacing'], 'the climb call stays');
    assert.equal(engineCall(d, ds).id, 'pacing');
    // a finish call that isn't about wheels stays
    assert.deepEqual(directorCalls({...ds, sprint: {state: 'keep-going', priority: 90}}).map(c => c.state), ['steep', 'keep-going']);
    // with draft: the same reading calls the gap
    assert.equal(engineCall(buildData({me, ds: {...ds, draftless: false}}), {...ds, draftless: false}).id, 'sprint');
});

test('draftless shows no word anywhere: the Grid must not say "change wheel" for a whole TT ride', async () => {
    const {allWords} = await import('../pages/src/grid-fields.mjs');
    const me = {self: true, state: {power: 250, speed: 40, draft: 0, grade: 0}};
    const d = buildData({me, ds: {groupSize: 6, draftless: true, positionState: 'no-draft', positionW: 20}});
    for (const [k, m] of Object.entries(d.meters)) assert.notEqual(m.state, 'no-draft', k);
    assert.equal(allWords(d).text, null);
});
