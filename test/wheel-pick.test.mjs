/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {WheelPick} from '../pages/src/wheel-pick.mjs';
import {groupLayout} from '../pages/src/engine/gap-curve.mjs';
import {UNIT_PER_M} from '../pages/src/engine/pack-cost.mjs';
import {MeterEngine, DESCENT_NOTE} from '../pages/src/meter-engine.mjs';

const T = 1_000_000;
// a rider `ahead` m in front of you, `aside` m to the side, at 36 km/h
const rider = (id, ahead, aside = 0, kmh = 36) => ({athleteId: id, gapDistance: -ahead,
    state: {roadId: 5, reverse: false, worldTime: T, speed: kmh, roadPosition: 9_000_000 + aside * UNIT_PER_M}});
const me = rider(1, 0);
me.self = true;

test('v0.60.1 (2026-11-07): a wheel a little to the side is still your wheel, not the next one in line 10 m up', () => {
    const w = new WheelPick();
    const pick = w.update([me, rider(2, 3, 0.8), rider(3, 12, 0)], me);
    assert.equal(pick.id, 2);
    assert.ok(Math.abs(pick.gap - 3) < 0.01);
    assert.equal(new WheelPick().update([me, rider(2, 3, 1.2), rider(3, 12, 0)], me).id, 2, '1.2 m aside at 3 m still beats 12 m in line');
    assert.equal(new WheelPick().update([me, rider(2, 3, 2.1), rider(3, 12, 0)], me).id, 3, 'over 2 m aside: no draft from them');
});

test('the user, 2026-11-07: "if I am getting good draft from a wheel, I should see gap to that wheel"', () => {
    const riders = [me, rider(2, 3, 1.4), rider(3, 7, 0)];
    assert.equal(new WheelPick().update(riders, me, {q: 0.8}).id, 2, 'good draft: the near wheel 1.4 m over gives it');
    assert.equal(new WheelPick().update(riders, me, {q: 0.1}).id, 3, 'little draft: the wheel in line 7 m up is the one to get on');
    assert.equal(new WheelPick().update(riders, me).id, 3, 'draft unknown: as little draft');
});

test('a rider alongside (wheels overlapping) is not a wheel unless right in line', () => {
    assert.equal(new WheelPick().update([me, rider(2, 0.8, 0.7), rider(3, 9)], me).id, 3);
    assert.equal(new WheelPick().update([me, rider(2, 0.8, 0.2), rider(3, 9)], me).id, 2, 'in line: your wheel');
});

test('the wheel you are on is kept against one barely better, not against one clearly better', () => {
    const w = new WheelPick();
    assert.equal(w.update([me, rider(2, 3, 0.3), rider(3, 4, -0.6)], me).id, 2);
    assert.equal(w.update([me, rider(2, 3.6, 0.5), rider(3, 3.0, -0.6)], me).id, 2, 'kept');
    assert.equal(w.update([me, rider(2, 6.5, 0.5), rider(3, 3.0, -0.3)], me).id, 3, 'the other gives clearly more draft');
    assert.equal(w.update([me, rider(2, 9, 0)], me).id, 2);
    assert.equal(w.update([me], me), null);
});

test('v0.60.1: your group does not split under 8 m (a slow climb: 1 s is 4.4 m at 16 km/h)', () => {
    const slow = [rider(1, 0, 0, 16), rider(2, 6.2, 0, 16), rider(3, 12, 0, 16)];
    assert.equal(groupLayout(slow).get(1).size, 3);
    const apart = [rider(1, 0, 0, 16), rider(2, 9, 0, 16)];
    assert.equal(groupLayout(apart).get(1).size, 1, 'past 8 m: apart');
    const fast = [rider(1, 0, 0, 45), rider(2, 11, 0, 45)];
    assert.equal(groupLayout(fast).get(1).size, 2, 'at 45 km/h 1 s is 12.5 m');
});

test('v0.60.1: Position is quiet on a fast descent (it read 65–104 W "close up" at 50+ km/h in the draft)', () => {
    const e = new MeterEngine();
    const spot = {positionW: 80, smoothed: true, best: {lo: 3, hi: 5}, boxed: false, gapW: 60};
    const p = e.readPosition({speed: 52, grade: -0.06, worldTime: T}, spot, {size: 5, ahead: 2, gapAhead: 7.5}, false, 150);
    assert.equal(p.state, 'coasting');
    assert.equal(p.w, null);
    assert.equal(p.note, DESCENT_NOTE);
    const flat = e.readPosition({speed: 52, grade: 0, worldTime: T + 1000}, spot, {size: 5, ahead: 2, gapAhead: 7.5}, false, 150);
    assert.notEqual(flat.state, 'coasting', 'fast on the flat: Position reads');
});
