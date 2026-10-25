/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {recButton, eventText, cardText, bikeText, inPen, cycleText, CYCLE_S} from '../pages/src/panel.mjs';
import {BIKES, WHEELS} from '../pages/src/rider-model.mjs';

test('the Record button shows the recording: "● 12:03", red', () => {
    assert.deepEqual(recButton({recording: true, startedAt: 0, now: 723_000}), {text: '● 12:03', on: true});
    assert.deepEqual(recButton({recording: true, startedAt: 0, now: 3_723_000}), {text: '● 1:02:03', on: true});
    assert.deepEqual(recButton({recording: false}), {text: 'Record', on: false});
    assert.deepEqual(recButton({recording: false, saving: true}), {text: 'Saving…', on: false});
});

test('the pen messages: event (with its category) or route, card, bike', () => {
    assert.equal(eventText({eventName: 'Stage 3 - Tour of Watopia 2026', subgroup: 'C', inEvent: true}), 'Stage 3 - Tour of Watopia 2026 (C)');
    assert.equal(eventText({routeName: 'Jarvis Seaside Sprint', inEvent: true}), 'Jarvis Seaside Sprint', 'the name not looked up yet');
    assert.equal(eventText({routeId: 5}), 'route…');
    assert.equal(cardText({cardName: 'Green to Screen', inEvent: true}), 'card: Green to Screen');
    assert.equal(cardText({inEvent: true}), 'no race card');
    assert.equal(cardText({}), null);
    const halo = BIKES.find(b => b.id === 'halo'), deep = WHEELS.find(w => w.id === 'deep');
    assert.equal(bikeText(halo, deep), 'bike: Halo · deep wheels');
    assert.equal(bikeText(BIKES.find(b => b.id === 'aero'), null), 'bike: Aero road bike');
});

test('the pen: in an event, not yet under way; the messages one at a time', () => {
    assert.equal(inPen({state: {eventSubgroupId: 7, eventDistance: 0}}), true);
    assert.equal(inPen({state: {eventSubgroupId: 7, eventDistance: 120}}), false, 'the race under way');
    assert.equal(inPen({state: {eventSubgroupId: 0, eventDistance: 0}}), false, 'a free ride');
    const msgs = ['Stage 3 (C)', null, 'OBS: connected · starts with the race in 3:20', 'bike: Halo'];
    assert.equal(cycleText(msgs, 0), 'Stage 3 (C)');
    assert.equal(cycleText(msgs, CYCLE_S * 1000), 'OBS: connected · starts with the race in 3:20', 'empty ones skipped');
    assert.equal(cycleText(msgs, 3 * CYCLE_S * 1000), 'Stage 3 (C)', 'round again');
    assert.equal(cycleText([null], 0), null);
});
