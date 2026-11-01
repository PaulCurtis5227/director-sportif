/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {planBridge, BRIDGE_PLAN} from '../pages/src/bridge-plan.mjs';
import {BridgeCoach} from '../pages/src/bridge.mjs';

const model = {massKg: 82, cda: 0.3, crr: 0.004};
const road = altAt => Array.from({length: 401}, (_, i) => ({d: i * 5, alt: altAt(i * 5)}));
const flat = road(() => 0);
const climbAt600 = road(d => (d < 600 ? 0 : Math.min(d - 600, 1000) * 0.06));
const base = {gapS: 3, rateSps: 0, vGroup: 40 / 3.6, grade: 0, model, ftpW: 234, frcLeftJ: 14000};

test('bridge plan: on the flat, now; the attack and the hold watts; a climb ahead is cheaper', () => {
    const p = planBridge({...base, profile: flat});
    assert.equal(p.best.startM, 0);
    assert.ok(p.best.attackW > p.best.powerW && p.best.powerW > 234, `${p.best.attackW} then ${p.best.powerW} W`);
    const c = planBridge({...base, rateSps: 0.02, profile: climbAt600});
    assert.ok(c.best.startM >= 600 && c.best.climb > 0.02, `starts at ${c.best.startM} m on the climb`);
    assert.ok(c.best.frcJ < c.now.frcJ / 2, `${Math.round(c.best.frcJ)} J on the climb vs ${Math.round(c.now.frcJ)} J now`);
});

test('bridge plan: a growing gap closes the window; too far = null; the reserve is kept', () => {
    const grow = planBridge({...base, rateSps: 0.05, profile: flat});
    assert.ok(grow.lastStartM < BRIDGE_PLAN.lookM, `last start ${grow.lastStartM} m`);
    assert.equal(planBridge({...base, gapS: 30, profile: flat}), null, '30 s up the road');
    assert.equal(planBridge({...base, frcLeftJ: BRIDGE_PLAN.reserveJ + 500, profile: flat}), null, 'nearly empty');
});

test('bridge coach: off until asked; under 3 s up the road nothing; now -> attack -> hold -> made it, then done', () => {
    const c = new BridgeCoach();
    const up = (aheadM, closeMps) => ({aheadM, closeMps, vGroup: 11.1, riders: 4, holeM: aheadM, closing: closeMps >= 0.3});
    const plan = () => planBridge({...base, profile: flat});
    assert.equal(c.update({wt: 0, armed: false, up: up(40, 0), power: 220, ftpW: 234, plan}), null);
    assert.equal(c.update({wt: 500, armed: true, up: up(25, 0), power: 220, ftpW: 234, plan}), null, '2.3 s up the road: assumed bridgeable');
    assert.equal(c.update({wt: 1000, armed: true, up: up(40, 0), power: 220, ftpW: 234, plan}).state, 'now');
    assert.equal(c.update({wt: 2000, armed: true, up: up(39, 1), power: 450, ftpW: 234, plan}).state, 'attack');
    const h = c.update({wt: 12000, armed: true, up: up(20, 1), power: 350, ftpW: 234, plan: () => planBridge({...base, gapS: 1.8, profile: flat, attack: false})});
    assert.equal(h.state, 'hold');
    assert.ok(h.powerW > 234 && h.powerW % 10 === 0, `hold ${h.powerW}`);
    const m = c.update({wt: 30000, armed: true, up: up(4, 1), power: 350, ftpW: 234, plan});
    assert.deepEqual([m.state, m.done], ['made', false]);
    assert.equal(c.update({wt: 37000, armed: true, up: null, power: 200, ftpW: 234, plan}).done, true);
});

test('bridge plan: never more than you have left (FTP + (max − FTP) × FRC share); on before the line', () => {
    // 2026-10-31 sprint: 20 m to close at 50 km/h with ~5 of 16 kJ left: the ceiling is ~520 W, not the 870 W asked for
    const sprint = {...base, gapS: 1.5, vGroup: 50 / 3.6, profile: flat, frcLeftJ: 5200, frcCapJ: 16000, pMaxW: 1050};
    const p = planBridge(sprint);
    const ceiling = 234 + (1050 - 234) * 5200 / 16000;
    assert.ok(!p || (p.best.powerW <= ceiling && p.best.attackW <= ceiling), JSON.stringify(p && p.best));
    const fresh = planBridge({...sprint, frcLeftJ: 16000, attack: false});
    assert.ok(fresh && fresh.best.powerW > ceiling, 'fresh, the same bridge may go harder');
    assert.equal(planBridge({...base, profile: flat, toLineM: 50}), null, '33 m to close, 50 m to the line');
});
