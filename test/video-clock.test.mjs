/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoClock, linkSeconds, obsActive} from '../pages/src/video-clock.mjs';
import {CaptureRecorder, readCapture} from '../pages/src/capture.mjs';

test('video clocks: recording and stream apart; already running when connecting = now − its duration', () => {
    const c = new VideoClock();
    assert.deepEqual(c.state('stream', true, 100_000, 60_000), {kind: 'stream', event: 'start', startMs: 40_000});
    assert.equal(c.state('stream', true, 101_000, 61_000), null, 'the same stream again: no change');
    assert.deepEqual(c.state('record', true, 120_000), {kind: 'record', event: 'start', startMs: 120_000});
    assert.deepEqual(c.starts, {record: 120_000, stream: 40_000});
    assert.deepEqual(c.state('record', false, 900_000), {kind: 'record', event: 'stop', startMs: 120_000});
    assert.equal(c.state('record', false, 901_000), null);
    assert.equal(c.state('other', true, 1), null);
    assert.equal(obsActive({outputActive: true}), true);
    assert.equal(obsActive(null), false);
});

test('a moment becomes seconds into each video (?t=); the clocks go into the recording', () => {
    assert.equal(linkSeconds(160_500, 40_000), 120);
    assert.equal(linkSeconds(30_000, 40_000), null, 'before the video started');
    const rec = new CaptureRecorder();
    rec.video(5, {kind: 'stream', event: 'start', startMs: 40_000});
    rec.tick(6, []);
    const cap = readCapture([rec._metaLine(), ...rec._lines].join('\n'));
    assert.deepEqual(cap.videos, [{t: 5, video: {kind: 'stream', event: 'start', startMs: 40_000}}]);
    assert.equal(cap.ticks.length, 1);
});
