/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildData, VOCAB, wordOf, helpOf, DATA_VERSION, CHANNEL} from '../pages/src/ds-data.mjs';
import {holdingStateOf} from '../pages/src/meter-engine.mjs';
import {MOTION_MS} from '../pages/src/engine/holding.mjs';

const me = (self = true) => ({self, state: {power: 250, speed: 40.2, draft: 55, cadence: 90, heartrate: 150, grade: 0.01}});

test('data object v1: every meter present, basics, no call yet', () => {
    const d = buildData({me: me(), ds: {groupSize: 5, positionW: 3, positionState: 'good'}}, {now: 1234});
    assert.equal(d.v, DATA_VERSION);
    assert.equal(d.ts, 1234);
    assert.equal(d.self, true);
    assert.deepEqual(Object.keys(d.meters).sort(),
        ['blocked', 'cda', 'demand', 'frc', 'gap', 'group', 'holding', 'pack', 'passing', 'position', 'side', 'surface', 'tuck']);
    for (const [k, m] of Object.entries(d.meters)) {
        assert.ok('value' in m && 'state' in m && 'level' in m, `${k} has value, state, level`);
        assert.ok(k in VOCAB, `${k} has words`);
    }
    assert.deepEqual(d.basics, {power: 250, speed: 40.2, draft: 55, cadence: 90, heartrate: 150, grade: 0.01});
    assert.equal(d.call, null);
    assert.equal(CHANNEL, 'director-sportif/v1');
});

test('privacy: a watched rider\'s heart rate never enters the object', () => {
    const d = buildData({me: me(false), ds: {groupSize: 1}});
    assert.equal(d.self, false);
    assert.equal(d.basics.heartrate, null);
});

test('words: short, no numbers; every state has a help line', () => {
    for (const [key, states] of Object.entries(VOCAB)) {
        for (const [st, {word, help}] of Object.entries(states)) {
            assert.ok(word.length <= 12, `${key}.${st} "${word}" ≤ 12 characters`);
            assert.doesNotMatch(word, /\d/, `${key}.${st}: no numbers in a word`);
            assert.equal(typeof help, 'string');
        }
    }
    assert.equal(wordOf('position', 'too-close'), 'back off');
    assert.equal(wordOf('position', 'nope'), '');
    assert.match(helpOf('holding', 'blocked'), /wheel/);
});

test('nothing to read: watt meters 0, distance meters null; the state says why', () => {
    const d = buildData({me: me(), ds: {groupSize: 1, settling: false}});
    for (const k of ['position', 'holding', 'pack', 'blocked']) {
        assert.equal(d.meters[k].value, 0, `${k} 0`);
        assert.equal(d.meters[k].level, null, `${k}: no level for an empty reading`);
    }
    assert.equal(d.meters.position.state, 'alone');
    for (const k of ['gap', 'side', 'tuck']) assert.equal(d.meters[k].value, null, `${k} null`);
    assert.equal(buildData({me: me(), ds: {groupSize: 6, settling: true}}).meters.holding.state, 'settling');
});

test('levels: the DS\'s own ranges (yellow / red)', () => {
    const lv = w => buildData({me: me(), ds: {groupSize: 6, positionW: w, positionState: 'too-close'}}).meters.position.level;
    assert.equal(lv(4), null);
    assert.equal(lv(12), 'warn');
    assert.equal(lv(25), 'warn');
    assert.equal(lv(30), 'alarm', 'red from 28 W (0.31.0: absolute Position)');
});

test('Holding follows the cause: blocked -> ease off, never "easy"; moving up is the price of the move', () => {
    assert.equal(holdingStateOf(null, 20, false, null), 'warming');
    assert.equal(holdingStateOf(5, 20, false, 0), 'hold');
    assert.equal(holdingStateOf(35, 20, false, 0), 'easy');
    assert.equal(holdingStateOf(35, 20, true, 0), 'blocked');
    assert.equal(holdingStateOf(35, 20, false, MOTION_MS + 0.1), 'moving-up');
    assert.equal(holdingStateOf(35, 20, true, MOTION_MS + 0.1), 'blocked', 'blocked wins over moving up');
    assert.equal(holdingStateOf(-30, 20, false, 0), 'drifting');
    assert.equal(wordOf('holding', 'blocked'), wordOf('blocked', 'blocked'), 'the same words as Blocked');
});

test('passing, blocked, gap and tuck states from the engine\'s reading', () => {
    const at = ds => buildData({me: me(), ds: {groupSize: 4, ...ds}}).meters;
    assert.equal(at({passKind: 'attack', passKmh: 2.4, passAtWheel: true}).passing.state, 'drop-back');
    assert.equal(at({passKind: 'attack', passKmh: 2.4, passWide: false}).passing.state, 'go-wide');
    assert.equal(at({passKind: 'attack', passKmh: 2.4, passWide: true}).passing.state, 'too-slow');
    assert.equal(at({passKind: 'defend', passKmh: 2, passWhere: 'on your right'}).passing.state, 'rider-right');
    assert.equal(at({passKind: 'defend', passKmh: 2, passWhere: 'behind'}).passing.state, 'rider-behind');
    assert.equal(at({}).passing.value, 0, 'in a group, nobody closing: 0');
    assert.equal(at({blocked: true, blockedSide: 'left', blockedW: 50}).blocked.state, 'blocked-left');
    assert.equal(at({blockedW: 0}).blocked.state, 'clear');
    assert.equal(at({gapM: 3, noDraftWheel: true}).gap.state, 'no-draft');
    assert.equal(at({gapM: null, beside: true}).gap.state, 'beside');
    const tuck = at({tuck: {state: 'build', needKmh: 1.3, drag: {tucked: {cda: 0.27, s: 7}, coast: {cda: 0.28, s: 12}}}}).tuck;
    assert.deepEqual([tuck.value, tuck.state], [1.3, 'build']);
    assert.deepEqual(tuck.drag, {tuck: 0.27, coast: 0.28, tuckS: 7, coastS: 12});
    assert.deepEqual([at({tuck: {state: 'ready', needKmh: 0}}).tuck.value, at({tuck: {state: 'ready'}}).tuck.state], [0, 'stop']);
    assert.equal(at({tuck: {state: 'draft'}}).tuck.value, null);
    assert.deepEqual(['stop', 'rest', 'stop'], [true, false, null].map(race => at({tuck: {state: 'ready', needKmh: 0, race}}).tuck.state));
    assert.equal(at({tuck: {state: 'ready', needKmh: 0, race: false}}).tuck.value, 0);
});

test('tuck drag field: the % between your CdA in the tuck and coasting, blank until both are measured', async () => {
    const {meterFields} = await import('../pages/src/meter-fields.mjs');
    const f = meterFields().find(x => x.id === 'ds-tuck-drag');
    const at = drag => ({dsData: buildData({me: me(), ds: {groupSize: 1, tuck: {state: 'tucked', needKmh: 0, drag}}})});
    assert.equal(f.format(at({tucked: {cda: 0.273, s: 7}, coast: {cda: 0.275, s: 12}})), '−1');
    assert.equal(f.format(at({tucked: {cda: 0.20, s: 7}, coast: {cda: 0.28, s: 12}})), '−29');
    assert.equal(f.format(at({tucked: {cda: 0.273, s: 7}, coast: null})), null);
    assert.equal(f.format(at(null)), null);
});

test('ride warnings: the surface meter and the FRC meter; surface and pacing calls with seconds and how long', async () => {
    const {directorCalls} = await import('../pages/src/ds-data.mjs');
    const {callWords} = await import('../pages/src/calls.mjs');
    const at = ds => buildData({me: me(), ds: {groupSize: 4, ...ds}}).meters;
    assert.deepEqual([at({surfaceW: 22.4, surfaceId: 'wood'}).surface.value, at({surfaceW: 22.4, surfaceId: 'wood'}).surface.state], [22.4, 'wood']);
    assert.equal(at({surfaceW: 0, surfaceId: 'pavement'}).surface.value, 0);
    assert.equal(wordOf('surface', 'wood'), 'wood');
    const frc = f => at({frc: {leftJ: f * 15000, frac: f, lowJ: 2000}}).frc;
    assert.deepEqual([frc(0.8).value, frc(0.8).state, frc(0.8).level], [12, 'ok', null]);
    assert.deepEqual([frc(0.2).state, frc(0.2).level], ['low', 'warn']);
    assert.deepEqual([frc(0.05).state, frc(0.05).level], ['empty', 'alarm']);
    assert.equal(at({}).frc.value, null, 'no FTP known: blank');
    const surf = directorCalls({surfaceAhead: {surface: 'dirt', inS: 14.6, forS: 41}})[0];
    assert.deepEqual(surf, {id: 'surface', state: 'dirt', word: 'dirt', in: 15, for: 40, priority: 20});
    assert.equal(callWords(surf), 'dirt in 15 for 40');
    const steep = directorCalls({pacing: {state: 'steep', inS: 22, forS: 31, grade: 0.08}})[0];
    assert.equal(callWords(steep), 'steep in 20 for 30');
    assert.equal(directorCalls({pacing: {state: 'top', inS: 12}})[0].word, 'over top');
    assert.equal(directorCalls({surfaceAhead: {surface: 'pavement', inS: 5}}).length, 0, 'no call for pavement');
    assert.equal(directorCalls({surfaceAhead: {surface: 'wood', inS: 105, forS: 10}}).length, 0, 'not 2 minutes ahead');
});

test('bend call: "inside left / right" when the inside is open, "stay close" on the outside, with the seconds to it', async () => {
    const {directorCalls} = await import('../pages/src/ds-data.mjs');
    const {callWords} = await import('../pages/src/calls.mjs');
    const [open] = directorCalls({bend: {state: 'open', side: 'left', inS: 6.2}});
    assert.deepEqual([open.id, open.state, open.word, open.in], ['bend', 'open-left', 'inside left', 6]);
    assert.equal(callWords(open), 'inside left in 6');
    const [out] = directorCalls({bend: {state: 'outside', side: 'right', inS: 4}});
    assert.equal(callWords(out), 'stay close', 'now, not at the bend');
    assert.deepEqual(directorCalls({bend: null}), []);
});

test('give room (a habit call) and the feather call before the steepest part', async () => {
    const {directorCalls} = await import('../pages/src/ds-data.mjs');
    const {callWords} = await import('../pages/src/calls.mjs');
    const [room] = directorCalls({nudge: {state: 'crowd', priority: 18}});
    assert.deepEqual([room.id, room.word], ['nudge', 'give room']);
    const [ready] = directorCalls({feather: {state: 'ready', inS: 22, grade: 0.07}});
    assert.equal(callWords(ready), 'hold FEATHER in 20');
    assert.equal(ready.id, 'powerup');
    assert.equal(callWords(directorCalls({feather: {state: 'fire', inS: 1}})[0]), 'FEATHER now');
});
