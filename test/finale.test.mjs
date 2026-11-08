/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {dsCall, engineCall, Announcer} from '../pages/src/calls.mjs';
import {directorCalls} from '../pages/src/ds-data.mjs';

test('a bridge you asked for speaks in the finish, over the finish advice, under its urgent calls', () => {
    const say = (bridge, sprint, finale) => engineCall({meters: {}}, {bridge, sprint, finale})?.word;
    const windup = {state: 'windup', priority: 90};
    assert.equal(say({state: 'hold', powerW: 350}, windup, 'run-in'), 'hold 350', 'in the run-in, over "get a wheel"');
    assert.equal(say({state: 'attack'}, {state: 'window-prep', priority: 86, inS: 20}, 'run-in'), 'attack');
    assert.equal(say({state: 'hold', powerW: 350}, null, 'sprint'), 'hold 350', 'the attack can read as your jump');
    assert.equal(say({state: 'made'}, windup, 'run-in'), 'made it');
    assert.equal(say({state: 'hold', powerW: 350}, {state: 'closer', priority: 94}, 'run-in'), 'dig in', 'a rider closing still wins');
    assert.equal(say({state: 'hold', powerW: 350}, {state: 'windup', priority: 90}, 'done'), undefined, 'past the line nothing');
    assert.equal(say({state: 'far'}, windup, 'run-in'), 'get a wheel', 'too far: the finish goes on');
    assert.equal(say({state: 'later', inS: 30}, windup, 'run-in'), 'get a wheel');
    assert.equal(say({state: 'far'}, null, 'run-in'), 'too far to bridge', 'said when nothing else is');
});

test('finale (2026-10-25): the run-in speaks only finish, power-up, card and gap calls; after the jump only the finish; past the line nothing', () => {
    const data = {meters: {blocked: {state: 'blocked'}, passing: {state: 'drop-back'}, position: {state: 'gapping'}}};
    const sprint = {id: 'sprint', state: 'position', word: 'top ten', priority: 60};
    const surface = {id: 'surface', state: 'wood', word: 'wood', priority: 20};
    assert.equal(dsCall(data, [sprint, surface]).id, 'gap', 'not the finale: the highest priority');
    assert.equal(dsCall(data, [sprint, surface], {finale: 'run-in'}).id, 'gap');
    assert.equal(dsCall({meters: {blocked: {state: 'blocked'}}}, [sprint, surface], {finale: 'run-in'}).id, 'sprint', 'no "ease off"');
    assert.equal(dsCall(data, [sprint, surface], {finale: 'sprint'}).id, 'sprint', 'after the jump: no "gap opening"');
    assert.equal(dsCall({meters: {}}, [surface], {finale: 'run-in'}), null, 'no surface call');
    assert.equal(dsCall(data, [sprint], {finale: 'done'}), null, 'past the line');
});

test('a segment card rides through: every call heard, on time, in the finish too', () => {
    const say = (c, s = 15) => ({about: 'pace', say: c, state: c, priority: 79, inS: s});
    const a = new Announcer();
    const heard = [];
    const ride = [[0, {card: {about: 'segment', kind: 'sprint', inS: 70, plan: 'contest', state: 'seg', priority: 75}}],
                  [55000, {card: say('go', 10), finale: 'run-in'}], [65000, {card: {...say('go, 730'), inS: null, state: 'now'}, finale: 'sprint'}],
                  [72000, {card: {...say('empty it'), inS: null, state: 'last'}, sprint: {state: 'windup', priority: 90}, finale: 'sprint'}]];
    for (const [t, ds] of ride) {
        const c = engineCall({meters: {}}, ds);
        const o = a.offer(c, {voice: true, chime: false}, t);
        if (o) heard.push(o.say);
    }
    assert.deepEqual(heard.slice(1), ['go in 10', 'go, 730', 'empty it'], 'each on time, over the finish\'s advice');
    assert.equal(engineCall({meters: {}}, {card: say('go'), sprint: {state: 'closer', priority: 94}, finale: 'run-in'}).word, 'dig in', 'a rider closing still wins');
    assert.equal(engineCall({meters: {}}, {card: say('go'), finale: 'done'}), null, 'past the line');
    assert.equal(engineCall({meters: {}}, {card: {about: 'pace', say: null, state: 'x', priority: 79}}), null, 'nothing to say');
});

test('announcer (2026-10-25): finish calls follow each other; the same one still waits', () => {
    const a = new Announcer();
    const d = {voice: true, chime: false};
    const c = (state, word) => ({id: 'sprint', state, word});
    assert.ok(a.offer(c('window-prep', 'jump'), d, 0));
    assert.ok(a.offer(c('window', 'you can go'), d, 10_000), 'another finish call 10 s later');
    assert.equal(a.offer(null, d, 11_000), null);
    assert.equal(a.offer(c('window', 'you can go'), d, 20_000), null, 'the same call again within the repeat time');
    const p = st => ({id: 'pass', state: st, word: 'drop back'});
    assert.ok(a.offer(p('drop-back'), d, 30_000));
    // v0.60.0: another message of the same type waits TYPE_NEW_S (10 s), the same words CALL_REPEAT_S (30 s)
    assert.equal(a.offer(p('too-slow'), d, 37_000), null, 'another message of the type within 10 s waits');
    assert.ok(a.offer(p('too-slow'), d, 41_000), 'another message of the type after 10 s is said');
    assert.equal(a.offer(p('drop-back'), d, 55_000), null, 'the same words again within 30 s wait');
    assert.ok(a.offer(p('drop-back'), d, 62_000), 'the same words after 30 s');
});

test('v0.60.0 (2026-11-07): "losing group" right after "gap opening", "block right" after "block left"', () => {
    const a = new Announcer();
    const d = {voice: true};
    assert.ok(a.offer({id: 'gap', state: 'opening', word: 'gap opening'}, d, 0));
    assert.ok(a.offer({id: 'gap', state: 'dropping', word: 'losing group'}, d, 14_000), 'was held to 30 s');
    assert.ok(a.offer({id: 'passed', state: 'left', word: 'block left'}, d, 30_000));
    assert.equal(a.offer({id: 'passed', state: 'right', word: 'block right'}, d, 34_000), null, 'the 6 s between calls still holds');
    assert.ok(a.offer({id: 'passed', state: 'right', word: 'block right'}, d, 41_000));
});

test('v0.60.0: off the back (10 m+ behind the wheel, held) is a spoken gap call; close up nearer is not a call', () => {
    const off = dsCall({meters: {position: {state: 'off-back'}}});
    assert.equal(off.id, 'gap');
    assert.equal(off.state, 'close-up');
    assert.equal(off.word, 'close up');
    assert.equal(dsCall({meters: {position: {state: 'close-up'}}}), null);
});

test('v0.60.0: "FEATHER in 10" outranks every finish call, briefly; the countdown before it does not', () => {
    const at = inS => directorCalls({feather: {state: 'ready', inS}}).find(c => c.id === 'powerup');
    assert.equal(at(60).state, 'feather-ready');
    assert.ok(at(60).priority < 86, 'under "jump in N"');
    const soon = at(11);
    assert.equal(soon.state, 'feather-soon');
    assert.equal(soon.in, 10);
    assert.ok(soon.priority > 87, 'over "you can go"');
    assert.equal(at(6).state, 'feather-ready', 'gone after 4 s, the line goes back to the finish');
});

test('v0.60.0: the call shown is one you can hear', () => {
    const data = {meters: {position: {state: 'off-back'}, passing: {state: 'rider-left'}}};
    assert.equal(engineCall(data, {}).id, 'gap');
    assert.equal(engineCall(data, {}, id => id !== 'gap').id, 'passed', 'gap muted: the next one you hear');
    assert.equal(engineCall(data, {}, () => false), null);
});

test('"jump in 20": the countdown to the sprint window, with its seconds', () => {
    const [c] = directorCalls({sprint: {state: 'window-prep', priority: 86, inS: 21.6, toLineS: 50}});
    assert.equal(c.word, 'jump');
    assert.equal(c.in, 20);
});

test('group shattering (2026-10-25) is its own call (v0.57.0: was a gap call)', () => {
    const c = dsCall({meters: {position: {state: 'shatter'}}});
    assert.equal(c.id, 'shatter');
    assert.equal(c.word, 'group shattering');
});
