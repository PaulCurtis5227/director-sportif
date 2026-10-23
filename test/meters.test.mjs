/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {MeterEngine, meterRider, SETTLING_NOTE, COASTING_NOTE} from '../pages/src/meter-engine.mjs';
import {buildData} from '../pages/src/ds-data.mjs';
import {riderModel, sizeFactor, WHEELS, AERO_SOCKS_FACTOR} from '../pages/src/rider-model.mjs';
import {meterFields, fmtSide, FT_PER_M} from '../pages/src/meter-fields.mjs';
import {UNIT_PER_M, packCostW} from '../pages/src/engine/pack-cost.mjs';
import {RoadMap} from '../pages/src/engine/road-map.mjs';
import {G} from '../pages/src/engine/physics.mjs';

// riders on one road at one moment: ahead = meters in front of the watched rider (me), lat = meters sideways (+ right)
const KMH = 36;
const rider = (id, ahead, lat = 0, {self = false, wt = 10000, x = 0} = {}) => ({
    athleteId: id, self, watching: self, gapDistance: -ahead,
    state: {worldTime: wt, speed: KMH, roadId: 5, reverse: false, roadPosition: lat * UNIT_PER_M, x: x - ahead * 100, y: 0},
});
const field = (id, opts) => meterFields(opts).find(f => f.id === id);
// what the window hands the fields: the data object built from the engine's reading
const shown = (ds, me = {self: true, state: {}}) => ({dsData: buildData({me, ds})});

test('meter rider: you first, else the watched rider', () => {
    const a = {athleteId: 1, watching: true}, b = {athleteId: 2, self: true};
    assert.equal(meterRider([a, b]), b);
    assert.equal(meterRider([a]), a);
    assert.equal(meterRider([]), null);
});

test('alone: no wheel, no pack cost', () => {
    const r = new MeterEngine().update([rider(1, 0, 0, {self: true})]);
    assert.equal(r.ds.gapM, null);
    assert.equal(r.ds.sideM, null);
    assert.equal(r.ds.packW, null);
    assert.equal(r.ds.groupSize, 1);
    assert.equal(r.ds.packNote, 'not in a group');
});

test('at the back with room: gap to the wheel in line, side, the cheapest pack spot', () => {
    const me = rider(1, 0, 0.3, {self: true});
    const all = [me, rider(2, 4.2, 0), rider(3, 5.5, 0.9), rider(4, 7, -0.4)];
    const {ds} = new MeterEngine().update(all);
    assert.ok(Math.abs(ds.gapM - 4.2) < 1e-9, `gap ${ds.gapM}`);
    assert.equal(ds.gapApprox, false);
    assert.ok(Math.abs(ds.sideM - 0.3) < 1e-9, `side ${ds.sideM}: you are 0.3 m right of the wheel`);
    assert.equal(ds.beside, false);
    assert.equal(ds.groupSize, 4);
    // the room figure (10 W at 37.4 km/h on a road tyre) for the rider model in use (riderModel defaults) at 36 km/h
    const m = riderModel({athlete: undefined});
    const want = packCostW({wheelGap: 4.2, ahead3: 0, boxed: false}, {size: 4, ahead: 3}, KMH / 3.6, m);
    assert.ok(Math.abs(ds.packW - want) < 1e-9, `pack ${ds.packW} vs ${want}`);
    assert.ok(ds.packW > 7 && ds.packW < 15, `the cheapest spot (${ds.packW})`);
    assert.match(ds.packNote, /room/);
});

test('reverse direction flips left and right', () => {
    const me = rider(1, 0, 0.3, {self: true}), w = rider(2, 3, 0);
    me.state.reverse = w.state.reverse = true;
    const {ds} = new MeterEngine().update([me, w]);
    assert.ok(Math.abs(ds.sideM + 0.3) < 1e-9);
});

test('no wheel in line: side to the nearest rider beside you, gap blank', () => {
    const {ds} = new MeterEngine().update([rider(1, 0, 0, {self: true}), rider(2, 1, 1.2)]);
    assert.equal(ds.gapM, null);
    assert.equal(ds.beside, true);
    assert.ok(Math.abs(ds.sideM + 1.2) < 1e-9, 'you are left of a rider 1.2 m to your right');
});

test('a teleport blanks the pack cost while settling', () => {
    const e = new MeterEngine();
    const group = (wt, x) => [rider(1, 0, 0, {self: true, wt, x}), rider(2, 4, 0, {wt, x}), rider(3, 6, 0, {wt, x})];
    assert.notEqual(e.update(group(10000, 0)).ds.packW, null);
    const r = e.update(group(11000, 500000));   // 5 km in a second
    assert.equal(r.ds.settling, true);
    assert.equal(r.ds.packW, null);
    assert.equal(r.ds.packNote, SETTLING_NOTE);
});

test('a wheel more than 25 m up the road is no wheel: gap and side blank', () => {
    const far = new MeterEngine().update([rider(1, 0, 0, {self: true}), rider(2, 30, 0.2)]).ds;
    assert.equal(far.gapM, null);
    assert.equal(far.sideM, null);
    assert.equal(far.beside, false);
    const edge = new MeterEngine().update([rider(1, 0, 0, {self: true}), rider(2, 25, 0)]).ds;
    assert.ok(Math.abs(edge.gapM - 25) < 1e-9, 'exactly 25 m still counts');
    const besideNear = new MeterEngine().update([rider(1, 0, 0, {self: true}), rider(2, 40, 0), rider(3, 2, 1.5)]).ds;
    assert.equal(besideNear.gapM, null, 'the wheel in line is too far');
    assert.equal(besideNear.beside, true);
    assert.ok(Math.abs(besideNear.sideM + 1.5) < 1e-9, 'side to the rider beside you instead');
});

test('rider model: bike type × size, your own CdA wins, hidden profile fields guessed', () => {
    const ref = riderModel({athlete: {height: 183, weight: 75}, bike: 'aero'});
    assert.ok(Math.abs(ref.cda - 0.298) < 1e-12, 'the reference rider gets the base');
    assert.equal(ref.massKg, 80);
    assert.equal(ref.source, 'Aero road bike, stock wheels × your size');
    const race = riderModel({athlete: {height: 183, weight: 75}, bike: 'aero', wheels: 'disc', socks: true});
    assert.ok(Math.abs(race.cda - 0.298 * 0.958 * AERO_SOCKS_FACTOR) < 1e-12);
    assert.equal(race.source, 'Aero road bike, disc, socks × your size');
    assert.ok(WHEELS.every((w, i) => i === 0 || w.factor < WHEELS[i - 1].factor), 'deeper is faster');
    assert.equal(riderModel({wheels: 'nonsense'}).wheels, 'stock');
    assert.equal(riderModel({athlete: {height: 183, weight: 75}, bike: 'aero', wheels: 'disc', socks: true, myCda: 0.3}).cda, 0.3,
        'your CdA replaces bike, wheels and socks');
    const small = riderModel({athlete: {height: 160, weight: 55}, bike: 'road'});
    assert.ok(Math.abs(small.cda / 0.312 - sizeFactor(160, 55)) < 1e-12);
    assert.ok(sizeFactor(160, 55) < 0.82 && sizeFactor(190, 95) > 1.12);
    assert.equal(riderModel({athlete: {height: 183, weight: 75}, myCda: 0.27}).cda, 0.27);
    assert.equal(riderModel({athlete: {height: 183, weight: 75}, myCda: '0.27'}).source, 'your CdA');
    for (const bad of [null, '', undefined, NaN, 0.05, 2]) {
        assert.ok(Math.abs(riderModel({athlete: {height: 183, weight: 75}, myCda: bad}).cda - 0.312) < 1e-12, `myCda ${bad} ignored`);
    }
    const minor = riderModel({athlete: {weight: 60}});
    assert.deepEqual(minor.hidden, ['height']);
    assert.match(minor.source, /height hidden: guessed/);
    assert.equal(riderModel({bike: 'nonsense'}).bike, 'road');
    assert.ok(riderModel({bike: 'gravel'}).crr > 1.8 * riderModel({bike: 'road'}).crr, 'gravel tyres roll ~2x on pavement');
});

// a steady group riding on flat road: you at `meAt` meters behind the front, everyone at the same speed and power
function groupRide(engine, {seconds, n = 6, gapM = 3, power = 250, kmh = 40, draft = 60, meIndex = 3, t0 = 100000}) {
    let r;
    for (let k = 0; k < seconds; k++) {
        const wt = t0 + k * 1000;
        const all = [];
        for (let i = 0; i < n; i++) {
            const ahead = (meIndex - i) * gapM;
            all.push({athleteId: i + 1, self: i === meIndex, watching: i === meIndex, gapDistance: -ahead,
                athlete: {height: 183, weight: 75},
                state: {worldTime: wt, speed: kmh, courseId: 6, roadId: 5, roadTime: 505000, reverse: false, roadPosition: 0,
                        power, altitude: 100,
                        grade: 0, draft: i === 0 ? 0 : draft, x: kmh / 3.6 * wt / 10 + ahead * 100, y: 0}});
        }
        r = engine.update(all);
    }
    return r;
}

test('position and holding: blank alone; in a group they read once warmed up', () => {
    const alone = new MeterEngine().update([rider(1, 0, 0, {self: true})]).ds;
    assert.equal(alone.positionW, null);
    assert.equal(alone.holdingW, null);
    assert.equal(alone.holdingNote, 'not in a group');
    const e = new MeterEngine();
    const early = groupRide(e, {seconds: 5}).ds;
    assert.equal(early.holdingW, null, 'the 20 s window is not full yet');
    assert.equal(early.holdingNote, 'filling the window…');
    assert.ok(Number.isFinite(early.positionW));
    const later = groupRide(e, {seconds: 30, t0: 105000}).ds;
    assert.ok(Number.isFinite(later.holdingW), 'warmed up after 20 s');
    assert.equal(later.holdingNote, 'holding place');
    assert.ok(Math.abs(later.holdingBandW - 20) < 1e-9);
    assert.ok(Math.abs(later.cda - 0.312) < 1e-9);
    assert.equal(later.groupSize, 6);
});

test('holding: more power for the same speed reads as more watts beyond what holding the place needs', () => {
    const lo = groupRide(new MeterEngine(), {seconds: 30, power: 200}).ds.holdingW;
    const hi = groupRide(new MeterEngine(), {seconds: 30, power: 300}).ds.holdingW;
    assert.ok(Math.abs(hi - lo - 100) < 1, `100 W more = +100 W Holding (${lo} -> ${hi})`);
});

test('position: coasting is blank', () => {
    const coast = groupRide(new MeterEngine(), {seconds: 5, power: 10}).ds;
    assert.equal(coast.positionW, null);
    assert.equal(coast.positionNote, COASTING_NOTE);
});

test('the rider model comes from modelFor', () => {
    const e = new MeterEngine({modelFor: me => riderModel({athlete: me.athlete, bike: 'tt'})});
    assert.ok(Math.abs(groupRide(e, {seconds: 2}).ds.cda - 0.264) < 1e-9);
});

test('stale riders (frozen avatars) are not the wheel', () => {
    const {ds} = new MeterEngine().update([rider(1, 0, 0, {self: true}), rider(2, 2, 0, {wt: 10000 - 5000})]);
    assert.equal(ds.gapM, null);
});

test('fields: gap, side and pack cost format for the Grid, with the meter\'s word under the value', () => {
    const x = shown({gapM: 4.234, gapApprox: true, sideM: -0.3, beside: false, packW: 11.6, packState: 'room',
        groupSize: 8});
    assert.equal(field('ds-gap').format(x), '~4.2');
    assert.equal(field('ds-side').format(x), `L ${(0.3 * FT_PER_M).toFixed(1)}`);
    assert.equal(field('ds-side', {sideUnit: 'm'}).format(x), 'L 0.30');
    assert.equal(field('ds-side', {sideUnit: 'm'}).suffix, 'm');
    assert.equal(field('ds-side').label(x), '', 'in line: no word');
    assert.equal(field('ds-pack').format(x), '12');
    assert.equal(field('ds-pack').label(x), 'room');
    assert.equal(field('ds-group').format(x), '8');
    for (const f of meterFields()) {
        assert.equal(f.format({}), null, `${f.id} blank without data`);
    }
    // nothing to read: watt meters 0, the rest blank (docs/DS-DATA.md, like Sauce's draft gauge)
    const alone = shown({groupSize: 1});
    for (const id of ['ds-position', 'ds-holding', 'ds-pack', 'ds-blocked']) {
        assert.equal(field(id).format(alone), '0', `${id} reads 0 alone`);
        assert.equal(field(id).label(alone), '', `${id}: no word alone`);
    }
    for (const id of ['ds-gap', 'ds-side', 'ds-tuck']) assert.equal(field(id).format(alone), null, `${id} blank alone`);
});

test('fields: the tooltip says what the word means right now', () => {
    const data = buildData({me: {self: true, state: {}}, ds: {groupSize: 6, positionW: 22, positionState: 'too-close'}});
    const f = field('ds-position', {current: () => data});
    assert.equal(f.label({dsData: data}), 'back off');
    assert.match(f.tooltip(), /Now: Too close to the wheel/);
    assert.doesNotMatch(field('ds-position').tooltip(), /Now:/, 'no data yet: the description only');
});

test('side: right behind the wheel reads 0', () => {
    assert.equal(fmtSide(0.01), '0.0');
    assert.equal(fmtSide(0.001, 'm'), '0.00');
    assert.equal(fmtSide(0.5), `R ${(0.5 * FT_PER_M).toFixed(1)}`);
    assert.equal(fmtSide(null), null);
    assert.equal(field('ds-side').format(shown({sideM: 0.01})), '0.0');
});

test('passing: creeping up 2.5 km/h faster on the wheel ahead shows after two ticks, with the advice', () => {
    const e = new MeterEngine();
    const mk = (wt, mySpeed) => {
        const me = rider(1, 0, 0, {self: true, wt, x: 0});
        me.state.speed = mySpeed;
        const other = rider(2, 3, 0.2, {wt, x: 0});
        other.state.speed = mySpeed - 2.5;
        const third = rider(3, 6, 0, {wt, x: 0});
        third.state.speed = mySpeed - 2.5;
        return [me, other, third];
    };
    assert.equal(e.update(mk(10000, 38)).ds.passKmh, null, 'one tick: not yet');
    const {ds} = e.update(mk(11000, 38));
    assert.equal(ds.passKind, 'attack');
    assert.ok(Math.abs(ds.passKmh - 2.5) < 1e-9);
    assert.match(ds.passNote, /held/);
    assert.equal(field('ds-pass').format(shown(ds)), '↑2.5');
    assert.equal(field('ds-pass').label(shown(ds)), 'go wide', 'in line with them: go wide');
});

test('surface: dirt on the Zwift map adds its rolling resistance, so Holding reads as on pavement', () => {
    const map = style => {
        const m = new RoadMap(null);
        m.setRoads(6, [{id: 5, path: [[0, 0, 0], [1e5, 0, 0], [2e5, 0, 0], [3e5, 0, 0]], styles: [{start: -1, end: 2, style}]}]);
        return m;
    };
    const pave = groupRide(new MeterEngine({roadMap: map('NORMAL')}), {seconds: 30}).ds;
    const dirt = groupRide(new MeterEngine({roadMap: map('DIRT')}), {seconds: 30}).ds;
    const none = groupRide(new MeterEngine(), {seconds: 30}).ds;
    assert.equal(pave.surface, 'pavement');
    assert.equal(dirt.surface, 'dirt');
    assert.equal(none.surface, null);
    assert.ok(Math.abs(pave.holdingW - none.holdingW) < 1e-6, 'pavement = no map');
    // Zwift Insider: road tyres 0.016 on dirt vs 0.004 on pavement, at 40 km/h for 75 + 5 kg; the pack cost is extra
    // rolling resistance too (pack-cost.mjs), so it grows with the surface, as in the Data Tap
    assert.ok(dirt.packW > pave.packW, 'rough road: the pack spot costs more');
    const want = (0.016 - 0.004) * 80 * G * 40 / 3.6 + (dirt.packW - pave.packW);
    assert.ok(Math.abs(pave.holdingW - dirt.holdingW - want) < 1, `dirt reads ${pave.holdingW - dirt.holdingW} W less (want ${want})`);
    const gravel = new MeterEngine({roadMap: map('DIRT'), modelFor: me => riderModel({athlete: me.athlete, bike: 'gravel'})});
    const gPave = new MeterEngine({roadMap: map('NORMAL'), modelFor: me => riderModel({athlete: me.athlete, bike: 'gravel'})});
    const dg = groupRide(gPave, {seconds: 30}).ds.holdingW - groupRide(gravel, {seconds: 30}).ds.holdingW;
    assert.ok(dg > 0 && dg < 20, `gravel tyres barely notice dirt (${dg} W)`);
});

test('fields: imperial shows the gap in ft and closing speeds in mph', () => {
    const x = shown({gapM: 3, passKmh: 3.2, passKind: 'attack', groupSize: 2});
    assert.equal(field('ds-gap', {imperial: true}).format(x), (3 * FT_PER_M).toFixed(1));
    assert.equal(field('ds-gap', {imperial: true}).suffix, 'ft');
    assert.equal(field('ds-pass', {imperial: true}).format(x), `↑${(3.2 / 1.609344).toFixed(1)}`);
    assert.equal(field('ds-pass', {imperial: true}).suffix, 'mph');
    assert.equal(field('ds-pass').suffix, 'km/h');
});

test('a wheel that gives no draft (hand cycle): Position blank with why, not "ease back" (group ride 2026-10-16)', () => {
    const e = new MeterEngine();
    // you (1) drafting a normal rider (2) 3 m ahead for 15 s, then on rider 3's wheel 3 m back with no draft at all
    const tick = (wt, wheelId, draft) => [
        {athleteId: 1, self: true, watching: true, gapDistance: 0, athlete: {height: 183, weight: 75},
         state: {worldTime: wt, speed: 36, courseId: 6, roadId: 5, roadTime: 505000, reverse: false, roadPosition: 0,
                 power: 200, altitude: 100, grade: 0, draft, x: 10 * wt / 10, y: 0}},
        {athleteId: wheelId, gapDistance: -3, athlete: {height: 180, weight: 70},
         state: {worldTime: wt, speed: 36, courseId: 6, roadId: 5, roadTime: 505000, reverse: false, roadPosition: 0,
                 power: 200, altitude: 100, grade: 0, draft: 0, x: 10 * wt / 10 + 300, y: 0}},
    ];
    let r;
    for (let k = 0; k < 15; k++) r = e.update(tick(100000 + k * 1000, 2, 60));
    assert.equal(r.ds.noDraftWheel, false);
    for (let k = 15; k < 40; k++) r = e.update(tick(100000 + k * 1000, 3, 0));
    assert.equal(r.ds.noDraftWheel, true);
    assert.equal(r.ds.positionW, null);
    assert.match(r.ds.positionNote, /no draft from this wheel/);
    assert.equal(field('ds-gap').label(shown(r.ds)), 'no draft');
    assert.equal(field('ds-position').label(shown(r.ds)), 'change wheel');
});

test('supertuck: race-aware (raceFor): coast in a race or not known yet, rest outside races', () => {
    const fast = () => {
        const me = rider(1, 0, 0, {self: true});
        Object.assign(me.state, {speed: 62, grade: -0.05, power: 200, draft: 0, altitude: 100});
        return [me];
    };
    const word = raceFor => {
        const out = new MeterEngine({raceFor}).update(fast());
        assert.equal(out.ds.tuck.state, 'ready');
        return buildData(out).meters.tuck.state;
    };
    assert.equal(word(() => true), 'stop', 'a race: stop pedaling');
    assert.equal(word(() => false), 'rest', 'a group ride: only a rest');
    assert.equal(word(() => null), 'stop', 'not known yet: as before');
    assert.equal(word(undefined), 'stop', 'no raceFor: as before');
});
