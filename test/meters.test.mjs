/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {MeterEngine, meterRider, SETTLING_NOTE, COASTING_NOTE} from '../pages/src/meter-engine.mjs';
import {buildData} from '../pages/src/ds-data.mjs';
import {engineCall} from '../pages/src/calls.mjs';
import {allWords} from '../pages/src/grid-fields.mjs';
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
    assert.equal(field('ds-gap').format(x), '2.7', 'wheel to wheel: 4.23 m center to center less a 1.5 m bike');
    assert.equal(field('ds-gap').shortName(x), 'Est. gap', 'estimated: the name says so, the number stays narrow');
    assert.equal(field('ds-gap').shortName(shown({gapM: 4.2, gapApprox: false})), 'Gap');
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
    // Zwift Insider: road tyres 0.016 on dirt vs 0.004 on pavement, at 40 km/h for 75 + 5 kg (riders confirm it:
    // dirt − pavement +0.0115, research/2026-10-30/dirt-crr.mjs). The pack costs the same on dirt (+0.0022 vs +0.0027
    // in Crr): priced with your pavement Crr (it read ~4x on dirt before)
    assert.ok(Math.abs(dirt.packW - pave.packW) < 1e-6, `the same pack cost on dirt (${dirt.packW} vs ${pave.packW})`);
    const want = (0.016 - 0.004) * 80 * G * 40 / 3.6;
    assert.ok(Math.abs(pave.holdingW - dirt.holdingW - want) < 1, `dirt reads ${pave.holdingW - dirt.holdingW} W less (want ${want})`);
    const gravel = new MeterEngine({roadMap: map('DIRT'), modelFor: me => riderModel({athlete: me.athlete, bike: 'gravel'})});
    const gPave = new MeterEngine({roadMap: map('NORMAL'), modelFor: me => riderModel({athlete: me.athlete, bike: 'gravel'})});
    const dg = groupRide(gPave, {seconds: 30}).ds.holdingW - groupRide(gravel, {seconds: 30}).ds.holdingW;
    assert.ok(dg > 0 && dg < 20, `gravel tyres barely notice dirt (${dg} W)`);
});

test('gap: wheel to wheel, overlapping wheels below 0 (no word of its own)', () => {
    const tight = shown({gapM: 1.2, groupSize: 8});
    assert.equal(field('ds-gap').format(tight), '-0.3');
    assert.equal(field('ds-gap').label(tight), '', 'no word: Blocked says ease off when it costs');
    assert.equal(tight.dsData.meters.gap.centerM, 1.2, 'the engine center-to-center gap rides along');
    const ok = shown({gapM: 1.65, groupSize: 8});
    assert.equal(field('ds-gap').format(ok), '0.1', 'six inches between wheels');
    assert.equal(field('ds-gap').label(ok), '');
});

test('fields: imperial shows the gap in ft and closing speeds in mph', () => {
    const x = shown({gapM: 3, passKmh: 3.2, passKind: 'attack', groupSize: 2});
    assert.equal(field('ds-gap', {imperial: true}).format(x), (1.5 * FT_PER_M).toFixed(1), '3 m center to center = 1.5 m wheel to wheel');
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

test('supertuck: race only (raceFor): coast in a race; outside one or not known yet, no word', () => {
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
    assert.equal(word(() => null), 'rest', 'not known yet: no word (the user, 2026-10-30: race only)');
    assert.equal(word(undefined), 'rest', 'no raceFor: no word');
});

test('no draft on a wheel (a TT bike, whatever the setting): no supertuck at all (2026-10-30, the Hanzo)', () => {
    const e = new MeterEngine({raceFor: () => true});
    let out = null;
    // 25 s on a wheel 2 m ahead with 0 W of draft (the bike setting left at its road default), then a fast descent
    for (let k = 0; k < 30; k++) {
        const me = rider(1, 0, 0, {self: true, wt: 10000 + k * 1000});
        const descent = k >= 25;
        Object.assign(me.state, {speed: descent ? 52 + (k - 25) : KMH, grade: descent ? -0.05 : 0, power: 250, draft: 0,
                                 altitude: 500 - k});
        out = e.update([me, rider(2, 2, 0, {wt: 10000 + k * 1000})]);
    }
    assert.equal(out.ds.draftless, true);
    assert.equal(out.ds.tuck.state, 'frame', 'a TT frame: no tuck, so no \"supertuck in N\" either');
});

test('supertuck in N: seconds to tuck speed while you gain it, nothing when you never get there (2026-10-30)', () => {
    // alone on a 4% descent, speeds per second: gaining 1 km/h a second from 48, or stuck at 46–48
    const ride = (speeds, race = true) => {
        const e = new MeterEngine({raceFor: () => race});
        let out = null;
        speeds.forEach((kmh, i) => {
            const me = rider(1, 0, 0, {self: true, wt: 10000 + i * 1000});
            Object.assign(me.state, {speed: kmh, grade: -0.04, power: 250, draft: 0, altitude: 500 - i * 0.5});
            out = e.update([me]);
        });
        return buildData(out).meters.tuck;
    };
    const gaining = ride([48, 49, 50, 51, 52]);
    assert.equal(gaining.state, 'soon');
    assert.equal(gaining.inS, 6, '6 km/h short at 1 km/h a second');
    assert.equal(gaining.word, 'supertuck in 6');
    assert.equal(field('ds-tuck').label({dsData: {meters: {tuck: gaining}}}), 'supertuck in 6');
    assert.equal(allWords({meters: {tuck: gaining}}).text, 'supertuck in 6');
    const stuck = ride([46, 47, 48, 47.5, 47]);
    assert.equal(stuck.state, 'build', 'not gaining: no word');
    assert.equal(allWords({meters: {tuck: stuck}}).text, null);
    assert.equal(stuck.value, 11, 'the meter still shows the km/h short');
    assert.equal(ride([48, 49, 50, 51, 52], false).state, 'build', 'a group ride or free ride: no word at all');
    assert.equal(ride([48, 49, 50, 51, 52], null).state, 'build', 'not known to be a race: no word');
    const far = ride([45, 45.3, 45.6, 45.9, 46.2]);
    assert.equal(far.state, 'build', '12 km/h short at 0.3 km/h a second: 39 s away is not soon');
});

test('block left / right: in a race only, never a teammate, never straight behind (2026-10-30)', () => {
    // a rider level with you on your right, 3 km/h faster (the held band), and a wheel ahead so you're in a group
    const tick = (e, k, {lat = 0.8, ahead = -0.5, team = null} = {}) => {
        const me = rider(1, 0, 0, {self: true, wt: 10000 + k * 1000});
        me.athlete = {team: 'Dinos'};
        const o = rider(2, ahead, lat, {wt: 10000 + k * 1000});
        o.state.speed = KMH + 3;
        o.athlete = {team};
        return e.update([me, o, rider(3, 3, 0, {wt: 10000 + k * 1000})]);
    };
    const state = (race, opts) => {
        const e = new MeterEngine({raceFor: () => race});
        let out = null;
        for (let k = 0; k < 4; k++) out = tick(e, k, opts);
        return buildData(out).meters.passing.state;
    };
    assert.equal(state(true), 'rider-right', 'a race: block right');
    assert.equal(state(false), 'none', 'a group ride or free ride: nothing (practice race turns raceFor on)');
    assert.equal(state(null), 'none', 'not known to be a race: nothing');
    assert.equal(state(true, {team: 'dinos'}), 'none', 'a teammate: never');
    assert.equal(state(true, {lat: 0, ahead: -3}), 'none', 'straight behind: nothing to do');
});

test('practice race on a free ride: the route end is the finish line', () => {
    // 1 km from the end of the route (Sauce: remainingType route on a free ride; 2026-10-09: it restarts each lap)
    const finale = (race, {type = 'route', sg = 0} = {}) => {
        const e = new MeterEngine({raceFor: () => race});
        let out = null;
        for (let k = 0; k < 3; k++) {
            const me = rider(1, 0, 0, {self: true, wt: 10000 + k * 1000});
            Object.assign(me, {remaining: 1000 - k * 10, remainingMetric: 'distance', remainingType: type});
            me.state.eventSubgroupId = sg;
            out = e.update([me, rider(2, 3, 0, {wt: 10000 + k * 1000})]);
        }
        return out.ds.finale;
    };
    assert.equal(finale(true), 'run-in', 'practice race (raceFor true, no event): the run-in to the route end');
    assert.equal(finale(false), null, 'a plain free ride: the route end is no finish');
    assert.equal(finale(true, {type: 'event', sg: 7}), 'run-in', 'an event: its own finish, as before');
});

// A bunch on a road Sauce has no map for (2026-10-29, Watopia's new roads): every gapDistance exactly 0, the list in
// Sauce's order (riders ahead, you, behind), each state its own age. True places: `places` m ahead of you (− = behind).
const RC_PER_M = 100;
const noMapTick = (k, places, {gaps = 'zero'} = {}) => {
    const wt = 100000 + k * 1000;
    const myRc = 400000 + k * 10 * RC_PER_M;   // 36 km/h = 10 m/s
    const me = {athleteId: 1, self: true, watching: true, gapDistance: 0,
                state: {worldTime: wt, speed: 36, courseId: 6, roadId: 196, reverse: false, roadPosition: 0, power: 200,
                        altitude: 100, grade: 0, draft: 120, roadCompletion: myRc, distance: 1000 + 10 * k, x: 0, y: 0}};
    const others = places.map((d, i) => {
        const age = [0.1, 1.1, 0.3, 0.9, 1.2, 0.2][i % 6];   // seconds old: Sauce's states arrive unevenly
        return {athleteId: 10 + i, gapDistance: gaps === 'zero' ? 0 : gaps === 'none' ? undefined : -d,
                state: {worldTime: wt - age * 1000, speed: 36, courseId: 6, roadId: 196, reverse: false,
                        roadPosition: (i % 3 - 1) * 0.3 * UNIT_PER_M, power: 200, altitude: 100, grade: 0, draft: 120,
                        roadCompletion: myRc + (d - age * 10) * RC_PER_M, x: 0, y: 0}};
    });
    return [...others.filter((_, i) => places[i] > 0), me, ...others.filter((_, i) => places[i] <= 0)];
};

test('bad input: every gap 0 (no map for the road) -> Gap blank, then measured; never age × speed, no gap calls', () => {
    const places = [4, 9, 15, 22, 30, -3, -8, -14];
    const e = new MeterEngine();
    let r = e.update(noMapTick(0, places));
    assert.equal(r.ds.gapSource, 'none');
    assert.equal(r.ds.gapM, null, 'blank until the road is measured, not the 0–1 m it read on 2026-10-29');
    assert.equal(buildData(r).meters.gap.state, 'no-map');
    assert.equal(buildData(r).meters.position.state, 'no-map');
    const calls = [];
    for (let k = 1; k < 40; k++) {
        r = e.update(noMapTick(k, places));
        const call = engineCall(buildData(r, {now: k * 1000}), r.ds);
        if (call) calls.push(`${call.id}/${call.state}`);
    }
    assert.equal(r.ds.gapSource, 'road');
    assert.ok(Math.abs(r.ds.gapM - 4) < 0.5, `the wheel 4 m up: ${r.ds.gapM}`);
    assert.equal(r.ds.gapApprox, true);
    assert.equal(r.ds.groupSize, places.length + 1);
    assert.deepEqual(calls.filter(c => /^gap\//.test(c)), [], 'a steady bunch never "shatters"');
});

test('bad input: every gap missing -> Gap blank and no gap calls (never a guess)', () => {
    const e = new MeterEngine();
    const calls = [];
    let r;
    for (let k = 0; k < 30; k++) {
        r = e.update(noMapTick(k, [4, 9, 15, -3], {gaps: 'none'}));
        const call = engineCall(buildData(r, {now: k * 1000}), r.ds);
        if (call) calls.push(call.id);
    }
    assert.equal(r.ds.gapM, null);
    assert.equal(r.ds.groupSize, 1);
    assert.deepEqual(calls.filter(c => c === 'gap' || c === 'pass' || c === 'passed'), []);
});

test('position: just after a gap opening it gives no advice while it reads your spot again', () => {
    const e = new MeterEngine();
    const tick = wt => [rider(1, 0, 0, {self: true, wt}), rider(2, 3.2, 0, {wt}), rider(3, 8, 0, {wt}), rider(4, 13, 0, {wt})]
        .map(o => (Object.assign(o.state, {power: 200, altitude: 100, grade: 0, draft: 60}), o));
    e.update(tick(98000));   // you (the first tick starts the meter rider)
    e.posQuietWt = 99000;    // a gap opening's last tick
    e.posGapOn = true;
    let r = e.update(tick(100000));
    assert.equal(r.ds.positionState, 'warming');
    assert.equal(e.posGapOn, false, 'started over on the first tick after');
    for (let wt = 101000; wt < 99000 + 10000; wt += 1000) r = e.update(tick(wt));
    assert.equal(r.ds.positionState, 'warming', 'still inside POSITION_TAU_S');
    r = e.update(tick(99000 + 10000));
    assert.notEqual(r.ds.positionState, 'warming', 'advice again once filled');
});

test('cut the S from the route ahead: called ~10 s out, quiet once you are in it (2026-10-30)', async () => {
    const {RouteAhead} = await import('../pages/src/route-ahead.mjs');
    // 300 m straight, then an S of two opposite 75° bends of radius 20 m, then straight (x/y/z in cm, as Sauce traces)
    const pts = [];
    let x = 0, y = 0, a = 0;
    for (let d = 0; d <= 700; d += 0.5) {
        pts.push([x * 100, y * 100, 0]);
        a += (d >= 300 && d < 326.2 ? 1 : d >= 326.2 && d < 352.4 ? -1 : 0) * 0.5 / 20;
        x += Math.cos(a) * 0.5;
        y += Math.sin(a) * 0.5;
    }
    const route = {zToAlt: z => z / 100, sections: [{}], curvePath: {nodes: [{index: 0}], trace: cb => pts.forEach(p => cb({stepNode: p, index: 0}))}};
    const e = new MeterEngine({routeAhead: new RouteAhead(() => route)});
    const tick = (k, d) => {
        const me = rider(1, 0, 0, {self: true, wt: 10000 + k * 1000});
        Object.assign(me.state, {routeId: 7, routeDistance: d, routeEnd: 700, laps: 0, speed: 36, altitude: 0, grade: 0});
        return e.update([me]);
    };
    tick(0, 100);
    await new Promise(r => setTimeout(r, 0));   // the route loads
    const seen = [];
    for (let k = 1; k <= 25; k++) {
        const d = 100 + k * 10;   // 10 m a second
        const out = tick(k, d);
        seen.push([d, out.ds.sCurve]);
    }
    const first = seen.find(([, sc]) => sc);
    assert.ok(first, 'called before the S');
    assert.ok(first[0] >= 180 && first[0] <= 290, `first called at ${first[0]} m (the S starts at 300): ${JSON.stringify(first[1])}`);
    assert.equal(first[1].s, true);
    assert.ok(first[1].inS <= 10.5, `within 10 s (${first[1].inS})`);
    assert.equal(seen.find(([d]) => d === 320)[1], null, 'in the S: no call');
});
