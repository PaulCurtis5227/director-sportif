/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TILES, DEFAULT_RANGES, MAX_COLUMNS, newTile, moveTile, cleanTiles, fieldCatalog, rangeLevel, shownNumber,
    layout} from '../pages/src/tiles.mjs';
import {meterFields} from '../pages/src/meter-fields.mjs';

const ids = new Set(meterFields().map(f => f.id));

test('the default tiles are all real meters, Position first', () => {
    assert.equal(DEFAULT_TILES[0].field, 'ds-position');
    for (const t of DEFAULT_TILES) assert.ok(ids.has(t.field), t.field);
    assert.equal(new Set(DEFAULT_TILES.map(t => t.id)).size, DEFAULT_TILES.length);
});

test('move a tile up or down; the ends and unknown ids leave the list alone', () => {
    const t = ['a', 'b', 'c'].map(id => ({id}));
    assert.deepEqual(moveTile(t, 'b', -1).map(x => x.id), ['b', 'a', 'c']);
    assert.deepEqual(moveTile(t, 'b', 1).map(x => x.id), ['a', 'c', 'b']);
    assert.deepEqual(moveTile(t, 'a', -1).map(x => x.id), ['a', 'b', 'c']);
    assert.deepEqual(moveTile(t, 'c', 1).map(x => x.id), ['a', 'b', 'c']);
    assert.deepEqual(moveTile(t, 'zz', 1).map(x => x.id), ['a', 'b', 'c']);
    assert.deepEqual(t.map(x => x.id), ['a', 'b', 'c'], 'the original is not changed');
});

test('new tiles get unique ids', () => {
    const a = newTile('ds-gap'), b = newTile('ds-gap');
    assert.notEqual(a.id, b.id);
    assert.equal(a.size, 'normal');
    assert.equal(a.note, true);
});

test('saved tiles are cleaned: unknown meters dropped, bad sizes normal, nothing saved = the defaults', () => {
    const out = cleanTiles([{id: 'x', field: 'ds-gap', size: 'huge'}, {id: 'y', field: 'gone'}, null,
                            {id: 'z', field: 'ds-pack', size: 'small', note: false}], ids);
    assert.deepEqual(out, [{id: 'x', field: 'ds-gap', size: 'normal', note: true, warn: null, alarm: null},
                           {id: 'z', field: 'ds-pack', size: 'small', note: false, warn: 25, alarm: 40}]);
    assert.deepEqual(cleanTiles(undefined, ids), DEFAULT_TILES);
    assert.deepEqual(cleanTiles([], ids), [], 'an emptied list stays empty');
});

test('field catalog: groups in order, each field once, names from longName', () => {
    const cat = fieldCatalog([
        {title: 'A', fields: [{id: 'f1', longName: 'One'}, {id: 'f2', shortName: () => 'Two'}]},
        {title: 'B', fields: [{id: 'f1', longName: 'dup'}, {id: 'f3', longName: () => { throw new Error('needs data'); }, shortName: 'Three'}]},
        {title: 'C', fields: []},
    ]);
    assert.deepEqual(cat.map(g => g.title), ['A', 'B']);
    assert.deepEqual(cat.flatMap(g => g.fields.map(f => `${f.id}:${f.name}`)), ['f1:One', 'f2:Two', 'f3:Three']);
});

test('color ranges: high is bad unless yellow is set above red; either may be off', () => {
    assert.equal(rangeLevel(5, 10, 30), '');
    assert.equal(rangeLevel(12, 10, 30), 'warn');
    assert.equal(rangeLevel(30, 10, 30), 'alarm');
    assert.equal(rangeLevel(-50, 20, 40), '', 'Holding below zero is fine');
    assert.equal(rangeLevel(15, 20, 10), 'warn', 'yellow above red: low is bad');
    assert.equal(rangeLevel(8, 20, 10), 'alarm');
    assert.equal(rangeLevel(25, 20, 10), '');
    assert.equal(rangeLevel(50, null, 40), 'alarm');
    assert.equal(rangeLevel(25, 20, null), 'warn');
    assert.equal(rangeLevel(25, null, null), '');
    assert.equal(rangeLevel(NaN, 10, 20), '');
});

test('the shown value as a number, whatever decorates it', () => {
    assert.equal(shownNumber('+12'), 12);
    assert.equal(shownNumber('-8'), -8);
    assert.equal(shownNumber('−5'), -5);
    assert.equal(shownNumber('L 1.2'), 1.2);
    assert.equal(shownNumber('↑2.5'), 2.5);
    assert.equal(shownNumber('~4.2'), 4.2);
    assert.ok(Number.isNaN(shownNumber('')));
    assert.ok(Number.isNaN(shownNumber('-')));
});

test('ranges: new and default tiles get the meter\'s starting range; old saved tiles too; a cleared one stays off', () => {
    assert.deepEqual([newTile('ds-blocked').warn, newTile('ds-blocked').alarm], DEFAULT_RANGES['ds-blocked']);
    assert.equal(newTile('ds-gap').warn, null);
    const holding = DEFAULT_TILES.find(t => t.field === 'ds-holding');
    assert.deepEqual([holding.warn, holding.alarm], DEFAULT_RANGES['ds-holding']);
    const ids = new Set(['ds-holding', 'ds-gap']);
    const [old] = cleanTiles([{id: 'a', field: 'ds-holding', size: 'large', note: true}], ids);
    assert.deepEqual([old.warn, old.alarm], DEFAULT_RANGES['ds-holding'], 'saved before ranges existed');
    const [off] = cleanTiles([{id: 'a', field: 'ds-holding', size: 'large', note: true, warn: null, alarm: null}], ids);
    assert.deepEqual([off.warn, off.alarm], [null, null], 'cleared in settings');
    const [set] = cleanTiles([{id: 'a', field: 'ds-gap', warn: '3', alarm: 1}], ids);
    assert.deepEqual([set.warn, set.alarm], [3, 1]);
});

test('layout: columns and tiles shown; old horizontal mode = one row', () => {
    const t = [1, 2, 3, 4, 5].map(i => ({id: `t${i}`}));
    assert.deepEqual(layout(t, {}), {shown: t, columns: 1});
    assert.deepEqual(layout(t, {columns: '2', maxTiles: '3'}), {shown: t.slice(0, 3), columns: 2});
    assert.equal(layout(t, {columns: 4, maxTiles: 2}).columns, 2, 'no more columns than tiles');
    assert.equal(layout(t, {maxTiles: 0}).shown.length, 5, '0 = all');
    assert.equal(layout(t, {horizMode: true}).columns, 5);
    assert.equal(layout(t, {columns: 1, horizMode: true}).columns, 1, 'columns, once set, win');
    assert.equal(layout(Array(20).fill(t[0]), {columns: 99}).columns, MAX_COLUMNS);
    assert.deepEqual(layout([], {columns: 3}), {shown: [], columns: 1});
});
