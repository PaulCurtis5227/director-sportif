/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {gridGroups, slotView, GRID_DEFAULT_TILES, METER_OF} from '../pages/src/grid-fields.mjs';
import {buildData} from '../pages/src/ds-data.mjs';
import {fieldCatalog, cleanTiles} from '../pages/src/tiles.mjs';

const me = {self: true, state: {power: 260, speed: 41.25, draft: 70, cadence: 92, heartrate: 148, grade: -0.034}};
const data = ds => buildData({me, ds: {groupSize: 7, ...ds}});
const fields = (opts) => new Map(gridGroups(opts).flatMap(g => g.fields).map(f => [f.id, f]));
const slot = (extra = {}) => ({note: true, warn: null, alarm: null, ...extra});

test('grid fields: meters, a word per meter, the basics; ids unique', () => {
    const groups = gridGroups();
    assert.deepEqual(groups.map(g => g.title), ['Director Sportif', 'Words', 'Basics']);
    const ids = groups.flatMap(g => g.fields.map(f => f.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ['ds-position', 'ds-director', 'ds-tuck-drag', 'ds-word-position', 'ds-word-passing', 'ds-power', 'ds-hr']) {
        assert.ok(ids.includes(id), id);
    }
    assert.ok(!ids.includes('ds-word-group'), 'no word field for a meter without words');
    for (const k of Object.keys(METER_OF)) assert.ok(ids.includes(k));
    // the default slots are all real fields
    const known = new Set(ids);
    assert.equal(cleanTiles(GRID_DEFAULT_TILES, known, GRID_DEFAULT_TILES).length, GRID_DEFAULT_TILES.length);
    assert.deepEqual(cleanTiles(undefined, known, GRID_DEFAULT_TILES).map(t => t.field), ['ds-position', 'ds-holding', 'ds-blocked', 'ds-gap', 'ds-side'],
        'a fresh Grid: the five that matter');
    assert.ok(GRID_DEFAULT_TILES.every(t => t.note === false), 'numbers only: the words are on the Director Sportif window');
    assert.ok(fieldCatalog(groups).length === 3);
});

test('a meter slot: name, number, unit, the word under it, the meter\'s own color', () => {
    const f = fields().get('ds-position');
    const v = slotView(f, slot(), data({positionW: 30, positionState: 'too-close'}));
    assert.deepEqual(v, {key: 'Position', value: '+30', unit: 'W', word: 'back off', level: 'alarm'}, 'red from 28 W');
    assert.equal(slotView(f, slot({note: false}), data({positionW: 24, positionState: 'too-close'})).word, '',
        'word switched off');
});

test('the slot\'s own thresholds win over the meter\'s level', () => {
    const f = fields().get('ds-position');
    const d = data({positionW: 24, positionState: 'too-close'});
    assert.equal(slotView(f, slot({warn: 30, alarm: 50}), d).level, '');
    assert.equal(slotView(f, slot({warn: 20, alarm: 50}), d).level, 'warn');
    assert.equal(slotView(fields().get('ds-power'), slot({warn: 250}), d).level, 'warn', 'a basic with thresholds');
    assert.equal(slotView(fields().get('ds-power'), slot(), d).level, '', 'a basic has no level of its own');
});

test('word slots, the director, basics; imperial', () => {
    const d = data({passKind: 'defend', passKmh: 2, passWhere: 'on your left'});
    d.call = {id: 'passed', state: 'left', word: 'block left', in: null, for: null, priority: 60};
    const F = fields();
    assert.equal(slotView(F.get('ds-word-passing'), slot(), d).value, 'block left');
    assert.equal(slotView(F.get('ds-word-passing'), slot(), d).level, '', 'a word slot is not colored by the meter');
    assert.equal(slotView(F.get('ds-director'), slot(), d).value, 'block left');
    assert.equal(slotView(F.get('ds-power'), slot(), d).value, '260');
    assert.deepEqual([slotView(F.get('ds-speed'), slot(), d).value, slotView(F.get('ds-speed'), slot(), d).unit], ['41.3', 'km/h']);
    assert.equal(slotView(F.get('ds-grade'), slot(), d).value, '-3.4');
    const I = fields({imperial: true});
    assert.deepEqual([slotView(I.get('ds-speed'), slot(), d).value, slotView(I.get('ds-speed'), slot(), d).unit], ['25.6', 'mph']);
});

test('no data (the Director Sportif window closed): every slot blank, no color', () => {
    for (const f of gridGroups().flatMap(g => g.fields)) {
        const v = slotView(f, slot(), null);
        assert.deepEqual([v.value, v.unit, v.word, v.level], ['', '', '', ''], f.id);
    }
    // alone: watt meters 0, words empty
    const alone = buildData({me, ds: {groupSize: 1}});
    assert.equal(slotView(fields().get('ds-holding'), slot(), alone).value, '0');
    assert.equal(slotView(fields().get('ds-word-position'), slot(), alone).value, '');
    assert.equal(slotView(fields().get('ds-gap'), slot(), alone).value, '');
});
