/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {obsPlanText, clockText} from '../pages/src/video-clock.mjs';

const now = 1_000_000;
const pen = {withRace: true, rehearsing: false, recording: false, ours: false, stopAt: null, sg: 7363894, ended: false,
             capturing: true, autoEvents: false, autoDone: false, start: now + 8 * 60_000, leadMs: 300_000,
             connected: true, now};

test('OBS line: the countdown in the pen (2026-10-25: nothing said OBS would start)', () => {
    assert.equal(obsPlanText(pen), 'starts with the race in 3:00', '8 min to the start, OBS 5 min before');
    assert.equal(obsPlanText({...pen, start: now + 98_000}), 'starts with the race now', 'joined 1:38 before the start');
    assert.equal(obsPlanText({...pen, connected: false}), 'starts with the race in 3:00, once connected');
    assert.equal(obsPlanText({...pen, start: 'pending'}), 'looking up the start…');
    assert.equal(obsPlanText({...pen, start: null}), 'starts with the race now', 'start not known: at once');
});

test('OBS line: nothing to count down', () => {
    assert.equal(obsPlanText({...pen, withRace: false}), null, '"Record OBS with the race" off');
    assert.equal(obsPlanText({...pen, sg: null}), null, 'the warm-up');
    assert.equal(obsPlanText({...pen, ended: true}), null, 'after your finish');
    assert.equal(obsPlanText({...pen, recording: true}), null, 'OBS already recording (yours)');
    assert.equal(obsPlanText({...pen, recording: true, ours: true, stopAt: now + 95_000}), 'stops in 1:35', 'ours, after the finish');
    assert.equal(obsPlanText({...pen, capturing: false}), 'starts when you press Record', 'no recording, no auto-record');
    assert.equal(obsPlanText({...pen, capturing: false, autoEvents: true}), 'starts with the race in 3:00', 'auto-record will start it');
    assert.equal(obsPlanText({...pen, capturing: false, autoEvents: true, autoDone: true}), 'starts when you press Record',
                 'you stopped this event\'s recording');
    assert.equal(clockText(65_000), '1:05');
});
