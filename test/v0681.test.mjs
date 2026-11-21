/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * v0.68.1 (the user, 2026-11-19 ride): "There was one place where I got a step left message when I was on the left rail";
 * "The time in the audio was one second behind the display. This should be configurable in the settings"; and "work
 * backwards to find when it [a bend] starts".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildData} from '../pages/src/ds-data.mjs';
import {dsCall, spokenWords, Announcer, audioDelayOf} from '../pages/src/calls.mjs';
import {bendsAlong, BEND_START_DEG, BEND_ONSET_PER10M, BEND_BACK_MAX_M} from '../pages/src/engine/bend-live.mjs';

const me = () => ({athleteId: 1, self: true, state: {athleteId: 1, worldTime: 1000, speed: 30, power: 200}});

test('already moving toward the free side: "stepping", no "step left" (v0.68.1)', () => {
    const at = ds => buildData({me: me(), ds: {groupSize: 4, ...ds}}).meters;
    assert.equal(at({blocked: true, blockedStep: 'left', blockedStepping: true, blockedW: 50}).blocked.state, 'stepping');
    assert.equal(at({blocked: true, blockedStep: 'left', blockedStepping: false, blockedW: 50}).blocked.state, 'step-left');
    const call = dsCall({meters: {blocked: {state: 'stepping'}, passing: {state: 'none'}, position: {state: 'good'}}});
    assert.ok(!call || call.id !== 'step', 'nothing to say while you step');
});

test('your audio delay comes off the spoken seconds, a number or read each time (v0.68.1)', () => {
    const bend = {id: 'bend', state: 'open-right', word: 'right', in: 10, for: null, priority: 45};
    assert.equal(spokenWords(bend, {chime: true}), 'right in 9');
    assert.equal(spokenWords(bend, {chime: true, delayS: 1}), 'right in 8');   // 1.34 + 1 s
    assert.equal(spokenWords({...bend, in: 2}, {chime: true, delayS: 1}), 'right', 'would reach 0: no number');
    for (const junk of [NaN, null, undefined, '1']) assert.equal(spokenWords(bend, {chime: true, delayS: junk}), 'right in 9', String(junk));
    // v0.69.1: negative = the voice reaches you early; the lead never below 0, clamped to AUDIO_DELAY_RANGE_S
    assert.equal(spokenWords({...bend, in: 10.4}, {chime: true, delayS: -0.5}), 'right in 10', '1.34 - 0.5 s');
    assert.equal(spokenWords(bend, {chime: true, delayS: -3}), 'right in 10', 'lead 0: the count the window shows');
    assert.equal(spokenWords(bend, {chime: true, delayS: -50}), 'right in 10', 'clamped');
    assert.equal(spokenWords(bend, {chime: true, delayS: 50}), 'right in 4', 'clamped to 5 s');
    assert.equal(audioDelayOf('-0.5'), -0.5);
    assert.equal(audioDelayOf('x'), 0);
    let lag = 1;
    const a = new Announcer({delayS: () => lag});
    assert.equal(a.offer(bend, {chime: true, voice: true}, 0).say, 'right in 8');
    lag = 0;
    assert.equal(new Announcer({delayS: () => lag}).offer(bend, {chime: true, voice: true}, 0).say, 'right in 9');
});

// a road along x, straight, then a turn that eases in at `easeDeg` per 5 m segment before turning hard (cm, every 5 m)
function road(easeSegs, easeDeg, hardDeg = 8, hardSegs = 10) {
    const pts = [];
    let x = 0, y = 0, a = 0, d = 0;
    const add = () => { pts.push({d, xy: [x, y]}); };
    add();
    const step = () => { x += 500 * Math.cos(a * Math.PI / 180); y += 500 * Math.sin(a * Math.PI / 180); d += 5; add(); };
    for (let i = 0; i < 40; i++) step();
    for (let i = 0; i < easeSegs; i++) { a += easeDeg; step(); }
    for (let i = 0; i < hardSegs; i++) { a += hardDeg; step(); }
    for (let i = 0; i < 40; i++) step();
    return pts;
}

test('a bend is found at the 5 deg point, and its start is walked back to where it begins to turn (v0.68.1)', () => {
    // eases in at 1 deg per 5 m (2 deg per 10 m) for 30 m, then turns 8 deg per 5 m
    const b = bendsAlong(road(6, 1))[0];
    assert.ok(b, 'found');
    assert.ok(b.startM < b.turnM, `${b.startM} < ${b.turnM}`);
    assert.ok(Math.abs(b.startM - 200) <= 5, `starts where the turning begins (200 m): ${b.startM}`);
    // a lead-in turning under the onset rate is the straight, not the bend
    const flat = bendsAlong(road(6, 0.2))[0];
    assert.ok(flat.turnM - flat.startM <= 5, `${flat.startM} vs ${flat.turnM}`);
    // never walked back further than BEND_BACK_MAX_M
    const long = bendsAlong(road(80, 0.6))[0];
    assert.ok(long.turnM - long.startM <= BEND_BACK_MAX_M + 5, `${long.turnM - long.startM}`);
    assert.ok(BEND_START_DEG === 5 && BEND_ONSET_PER10M === 1);
});
