/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CaptureRecorder, readCapture, RIDER_FIELDS} from '../pages/src/capture.mjs';
import {Checkpoint, memoryStore} from '../pages/src/engine/checkpoint.mjs';
import zlib from 'node:zlib';

const entry = (athleteId, {self = false, speed = 40, gap = 0, power = 300, hr = 150, wt = 1000} = {}) => ({
    athleteId, self, gapDistance: gap, athlete: {sanitizedFullname: `Rider ${athleteId}`, weight: 70},
    state: {worldTime: wt, roadId: 5, reverse: false, roadCompletion: 500000 + gap, roadPosition: 1000, speed,
            draft: 50, power, cadence: 90, heartrate: hr, activePowerUp: null},
});

test('capture: other riders keep only position and draft, under a random id; you keep everything', () => {
    const rec = new CaptureRecorder({meta: {v: 'test'}, now: 1});
    rec.tick(10, [entry(1, {self: true}), entry(2, {gap: 5}), entry(3, {gap: -3})]);
    const text = [rec._metaLine(), ...rec._lines].join('\n');
    assert.doesNotMatch(text.split('\n')[1].replace(/"me":\{.*?"state":\{[^}]*\}\}/, ''), /power|cadence|heartrate|Rider [23]|"2"|weight/,
        'no power, cadence, heart rate, names or body data for other riders');
    const cap = readCapture(text);
    assert.equal(cap.ticks[0].me.athleteId, 1, 'your own entry, full');
    assert.equal(cap.ticks[0].me.state.power, 300);
    assert.equal(cap.ticks[0].riders.length, 2);
    for (const r of cap.ticks[0].riders) {
        assert.match(r.id, /^[0-9a-f]{8}$/);
        assert.deepEqual(Object.keys(r).sort(), ['id', ...RIDER_FIELDS].sort());
        assert.equal(r.draft, 50);
        assert.equal(r.speed100, 4000);
    }
    assert.equal(cap.ticks[0].riders.find(r => r.gapCm === 500).roadCompletion, 500005);
});

test('capture: unchanged values are left out and come back on reading; ids differ between recordings', () => {
    const rec = new CaptureRecorder();
    rec.tick(10, [entry(2, {speed: 40, wt: 1000})]);
    rec.tick(11, [entry(2, {speed: 40, wt: 2000})]);
    rec.tick(12, [entry(2, {speed: 41, wt: 3000})]);
    const row2 = JSON.parse(rec._lines[1]).r[0];
    assert.equal(row2.length, 2, 'only the id and the new worldTime');
    const cap = readCapture([rec._metaLine(), ...rec._lines].join('\n'));
    assert.deepEqual(cap.ticks.map(t => [t.riders[0].worldTime, t.riders[0].speed100, t.riders[0].roadId]),
        [[1000, 4000, 5], [2000, 4000, 5], [3000, 4100, 5]]);
    const other = new CaptureRecorder();
    other.tick(10, [entry(2)]);
    assert.notEqual(JSON.parse(other._lines[0]).r[0][0], JSON.parse(rec._lines[0]).r[0][0], 'nothing links two recordings');
});

test('capture: the call and marks are kept; stored crash-safe through the checkpoint like the Data Tap\'s', async () => {
    const rec = new CaptureRecorder({now: 7});
    const store = memoryStore();
    const cp = new Checkpoint(store, {name: 'ds-capture-test', rec, release: true});
    await cp.begin();
    rec.tick(10, [entry(1, {self: true}), entry(2)], {id: 'moveUp', state: 'move', in: null});
    rec.mark(11, 'weird');
    await cp.flush();
    assert.equal(rec._lines.length, 0, 'released from memory once stored');
    rec.tick(12, [entry(1, {self: true}), entry(2)]);
    const blob = await cp.blob();
    const text = zlib.gunzipSync(Buffer.from(await blob.arrayBuffer())).toString();
    const cap = readCapture(text);
    assert.equal(cap.ticks.length, 2);
    assert.deepEqual(cap.ticks[0].call, ['moveUp', 'move', null]);
    assert.deepEqual(cap.marks, [{t: 11, mark: 'weird'}]);
});

test('the version in a recording is the mod\'s (DS_VERSION = manifest.json)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../pages/src/meters.mjs', import.meta.url), 'utf8');
    const v = src.match(/export const DS_VERSION = '([^']+)'/)[1];
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(v, manifest.version);
});
