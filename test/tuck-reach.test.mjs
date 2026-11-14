/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {tuckReachS, TUCK_SOON} from '../pages/src/meter-engine.mjs';

// the user's road bike: 77 kg + 8, CdA ~0.28
const model = {massKg: 85, cda: 0.28, crr: 0.004};

test('supertuck in N: a −5% descent at ~180 W tops out below 58 km/h within the window: no countdown (2026-11-12)', () => {
    // ToW stage 3 18:24: 49 km/h, −4.9%, 168–192 W; the old straight line said "supertuck in 9–12", top speed 54.1
    assert.equal(tuckReachS({kmh: 49.1, targetKmh: 58, power: 180, model, grade: -0.049}), null);
    // 18:45: 52.7 km/h on −5.4%, easing to −4.1% over the next 150 m (the descent's end): on the road ahead, no
    const ahead = [{d: 0, alt: 50}, {d: 40, alt: 47.8}, {d: 190, alt: 41.65}, {d: 400, alt: 37}];
    assert.equal(tuckReachS({kmh: 52.7, targetKmh: 58, power: 189, model, grade: -0.054, ahead}), null);
});

test('supertuck in N: a steep descent gets there, and the seconds count down', () => {
    const a = tuckReachS({kmh: 48, targetKmh: 58, power: 150, model, grade: -0.09});
    assert.ok(a > 0 && a <= TUCK_SOON.soonS, `steep −9%: reached in ${a} s`);
    const b = tuckReachS({kmh: 53, targetKmh: 58, power: 150, model, grade: -0.09});
    assert.ok(b < a, 'closer to the speed: sooner');
    assert.equal(tuckReachS({kmh: 58.5, targetKmh: 58, power: 0, model, grade: -0.09}), 0, 'already there');
});

test('supertuck in N: the road ahead decides when it is known (a descent that ends does not get you there)', () => {
    // −9% now, but the profile flattens 60 m on: the grade now alone would say yes
    const ahead = [{d: 0, alt: 100}, {d: 60, alt: 94.6}, {d: 600, alt: 94.6}];
    assert.ok(tuckReachS({kmh: 46, targetKmh: 58, power: 150, model, grade: -0.09}) != null, 'on the grade now: reachable');
    assert.equal(tuckReachS({kmh: 46, targetKmh: 58, power: 150, model, grade: -0.09, ahead}), null, 'with the road ahead: no');
});

test('supertuck in N: no model, no numbers (nothing said)', () => {
    assert.equal(tuckReachS({kmh: 50, targetKmh: 58, power: 200, model: null, grade: -0.08}), null);
});
