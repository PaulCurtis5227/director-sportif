/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {routeProfile, profileAhead, speedAt, withSpeeds, RouteAhead, routeSections, curvyStretch, S_CURVE} from '../pages/src/route-ahead.mjs';
import {nextClimb} from '../pages/src/engine/director.mjs';

/*
 * A route in Sauce's shape (common.mjs getRoute): nodes every 50 m; a 200 m lead-in (section 0), then a 3 km lap
 * (section 1): flat for 2 km, a 1 km climb at 5%; a 100 m join between laps (lapWeldData) back down.
 */
function sauceRoute({laps = true} = {}) {
    const distances = [], elevations = [], nodes = [];
    for (let d = 0; d <= 3200; d += 50) {
        distances.push(d);
        const lap = d - 200;
        elevations.push(lap <= 2000 ? 10 : 10 + (lap - 2000) * 0.05);
        nodes.push({index: d < 200 ? 0 : 1});
    }
    return {
        supportedLaps: laps, distances, elevations, curvePath: {nodes},
        sections: [{leadin: true}, {}],
        lapWeldData: {distances: [0, 50, 100], elevations: [60, 35, 10]},
    };
}

test('route profile: lead-in + lap first, join + lap for the laps after', () => {
    const p = routeProfile(sauceRoute());
    assert.equal(p.first.at(-1).d, 3200);
    assert.equal(p.cycle.at(-1).d, 3100, 'join 100 m + lap 3000 m');
    assert.equal(p.cycle[0].alt, 60, 'the join starts at the top');
    assert.equal(routeProfile(sauceRoute({laps: false})).cycle, null);
    assert.equal(routeProfile(null), null);
});

test('placed by the distance left in the lap (routeEnd − routeDistance), as Sauce\'s elevation window does', () => {
    const p = routeProfile(sauceRoute());
    // first lap, 1000 m into the lap: 2200 m left of 3200
    const a = profileAhead(p, {routeEnd: 3200, routeDistance: 1000, laps: 0}, 1500);
    assert.ok(Math.abs(a[0].d - 50) < 1e-9 && a[0].alt === 10);
    assert.equal(a.find(x => x.d >= 1500).alt, 10 + (2500 - 2200) * 0.05, 'the climb starts 1200 m ahead');
    // past the lap's finish it runs into the next lap: the join, then the flat
    const b = profileAhead(p, {routeEnd: 3200, routeDistance: 3100, laps: 0}, 400);
    assert.equal(b.find(x => x.d >= 150).alt, 35, 'the join after the line');
    // a later lap uses the join + lap sequence
    const c = profileAhead(p, {routeEnd: 3100, routeDistance: 0, laps: 1}, 200);
    assert.equal(c[0].alt, 35);
    // doesn't fit (more left than the lap is long), or no position
    assert.equal(profileAhead(p, {routeEnd: 9000, routeDistance: 0, laps: 0}), null);
    assert.equal(profileAhead(p, {routeEnd: 3200, laps: 0}), null);
});

test('the climb ahead from the route: alone, no riders needed', () => {
    const p = routeProfile(sauceRoute());
    const s = {routeEnd: 3200, routeDistance: 1000, laps: 0};
    const pts = withSpeeds(profileAhead(p, s, 3000), {vFlat: 11, power: 250, massKg: 85, cda: 0.3, crr: 0.0045, bodyKg: 77});
    const c = nextClimb(pts, {vNow: 11, grade: 0});
    assert.ok(c, 'found');
    assert.ok(Math.abs(c.inM - 1200) <= 60, `foot ${c.inM} m ahead`);
    assert.ok(Math.abs(c.secs - 1200 / 11) < 8, `${c.secs.toFixed(1)} s at 11 m/s on the flat`);
    assert.ok(c.riseM >= 40, `rise ${c.riseM}`);
});

test('speeds ahead: your flat speed, slower on climbs at your effort, never faster; steady, not today\'s bump', () => {
    const m = {massKg: 85, cda: 0.3, crr: 0.0045};
    const flat = speedAt(250, 0, m), climb = speedAt(250, 0.06, m);
    assert.ok(flat > 10 && flat < 13, `250 W flat ${flat.toFixed(2)} m/s`);
    assert.ok(climb > 3.5 && climb < 5, `250 W at 6% ${climb.toFixed(2)} m/s`);
    const pts = withSpeeds([{d: 50, alt: 0}, {d: 100, alt: 0}, {d: 150, alt: 3}, {d: 200, alt: 6}, {d: 250, alt: 9}],
                           {vFlat: 11, power: 250, ...m, bodyKg: 77});
    assert.equal(pts[0].v, 11);
    assert.ok(pts.at(-1).v < 6, `on 6%: ${pts.at(-1).v.toFixed(2)} m/s`);
    assert.ok(pts.every(p => p.v <= 11));
    // no effort known (or coasting): the floor, 2 W/kg, not 0 W
    const coast = withSpeeds([{d: 50, alt: 0}, {d: 100, alt: 3}, {d: 150, alt: 6}], {vFlat: 11, power: 0, ...m, bodyKg: 77});
    assert.ok(coast.at(-1).v > 2, 'a climb still gets a speed');
    // a gentle drag (≤ 2%) rides at the flat speed
    const drag = withSpeeds([{d: 50, alt: 0}, {d: 100, alt: 0.75}, {d: 150, alt: 1.5}], {vFlat: 11, power: 250, ...m, bodyKg: 77});
    assert.ok(drag.every(p => p.v === 11));
});

test('speeds ahead: a descent at least the speed your effort holds there; the next 200 m at least your speed now', () => {
    const m = {massKg: 85, cda: 0.3, crr: 0.0045};
    // flat to 100 m, then 6% down
    const pts = [{d: 50, alt: 50}, {d: 100, alt: 50}, {d: 300, alt: 38}, {d: 500, alt: 26}, {d: 700, alt: 14}];
    const sp = withSpeeds(pts, {vFlat: 7, power: 200, ...m, bodyKg: 77});
    assert.ok(sp.at(-1).v > 15, `6% down at 200 W: ${sp.at(-1).v.toFixed(1)} m/s, not the 7 m/s flat speed`);
    const now = withSpeeds([{d: 50, alt: 0}, {d: 150, alt: 0}, {d: 400, alt: 0}], {vFlat: 8, power: 200, ...m, bodyKg: 77, vNow: 13});
    assert.deepEqual(now.map(p => p.v), [13, 13, 8], 'your speed now for 200 m, then the flat speed');
});

test('RouteAhead: loads a route once, null while it loads or off a route', async () => {
    let loads = 0;
    const ra = new RouteAhead(async () => { loads++; return sauceRoute(); });
    const s = {routeId: 7, routeEnd: 3200, routeDistance: 1000, laps: 0};
    assert.equal(ra.ahead(s), null, 'loading');
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(ra.ahead(s).length > 10);
    ra.ahead(s);
    assert.equal(loads, 1);
    assert.equal(ra.ahead({routeId: null}), null);
    assert.equal(ra.ahead({routeId: 7}), null, 'no route distance (Sauce leaves it out before the start)');
});

test('the route roads in order for the surface ahead: welds dropped, laps kept', async () => {
    const r = {supportedLaps: true, sections: [
        {roadId: 0, reverse: true, start: 0.6, end: 0.98, leadin: true}, {roadId: 25, reverse: true, start: 0.16, end: 0.8},
        {roadId: 21, start: 0.13, end: 0.99}, {roadId: 0, start: 0.1, end: 0.2, weld: true}]};
    assert.deepEqual(routeSections(r), {laps: true, sections: [
        {roadId: 0, reverse: true, start: 0.6, end: 0.98, leadin: true}, {roadId: 25, reverse: true, start: 0.16, end: 0.8, leadin: false},
        {roadId: 21, reverse: false, start: 0.13, end: 0.99, leadin: false}]});
    assert.equal(routeSections({}), null);
    const ra = new RouteAhead(async () => r);
    assert.equal(ra.sections({routeId: 5}), null, 'loading');
    await new Promise(res => setTimeout(res, 0));
    assert.equal(ra.sections({routeId: 5}).sections.length, 3);
    assert.equal(ra.sections({}), null, 'off a route');
});

/*
 * A traced route (Sauce's CurvePath.trace walks the road in small steps; x/y/z in cm): 300 m straight, then an S of
 * two opposite 75° bends of radius 20 m (~26 m each), then straight again.
 */
function tracedRoute() {
    const pts = [];
    let x = 0, y = 0, a = 0;
    const step = 0.5;
    const turnAt = d => (d >= 300 && d < 326.2 ? 1 : d >= 326.2 && d < 352.4 ? -1 : 0);
    for (let d = 0; d <= 700; d += step) {
        pts.push([x * 100, y * 100, 0]);
        a += turnAt(d) * step / 20;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
    }
    return {zToAlt: z => z / 100, sections: [{}], curvePath: {nodes: [{index: 0}],
        trace: (cb) => pts.forEach(p => cb({stepNode: p, index: 0}))}};
}
const at = d => ({routeId: 1, routeDistance: d, routeEnd: 700, laps: 0});

test('cut the S: the route traced with its direction; a twisting stretch ahead is found, a straight road is not', () => {
    const prof = routeProfile(tracedRoute());
    const near = profileAhead(prof, at(220), 400);
    assert.ok(near.every(p => Number.isFinite(p.a) || p.d < 6), 'the road direction on every traced point');
    const s = curvyStretch(near, () => S_CURVE.paveDeg);
    assert.ok(s, 'an S of 2 x 75 deg = 150 deg: past the pavement line');
    assert.ok(s.startM >= 78 && s.startM <= 95, `where the turning starts, the S at 80 m ahead (${s.startM} m; 5 m points, 10° to count)`);
    assert.ok(s.turnDeg >= S_CURVE.paveDeg && s.turnDeg < 160, `turning ${s.turnDeg}: the first window past the line`);
    assert.equal(s.s, true, 'both ways: an S');
    assert.equal(curvyStretch(profileAhead(prof, at(20), 200), () => S_CURVE.paveDeg), null, 'straight road ahead');
    assert.equal(curvyStretch(profileAhead(prof, at(310), 300), () => S_CURVE.paveDeg), null, 'already in it: no call');
    // dirt calls it from 90 deg: half the S (one 75 deg bend) is not enough on pavement
    const half = profileAhead(prof, at(220), 400).filter(p => p.d < 107);
    assert.equal(curvyStretch(half, () => S_CURVE.paveDeg), null);
    assert.equal(curvyStretch(half, () => 60)?.s, false, 'one bend: a hairpin, not an S');
});

test('cut the S: the call words, in seconds; a hairpin is "cut the bend"', async () => {
    const {directorCalls} = await import('../pages/src/ds-data.mjs');
    const {callWords} = await import('../pages/src/calls.mjs');
    const s = directorCalls({sCurve: {inS: 6.4, turnDeg: 150, s: true, dirt: true}}).find(c => c.id === 'bend');
    assert.equal(callWords(s), 'cut the S in 6');
    const h = directorCalls({sCurve: {inS: 4, turnDeg: 130, s: false, dirt: false}}).find(c => c.id === 'bend');
    assert.equal(callWords(h), 'cut the bend in 4');
    assert.equal(directorCalls({}).find(c => c.id === 'bend'), undefined);
});
