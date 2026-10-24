/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {dsCall, callWords, Announcer, deliveryDefaults, deliveryFor, deliveryKey,
    localizeUnits, deliveryGridHTML, DELIVERY, CALL_PRIORITY,
    CALL_TYPES, CALL_REPEAT_S} from '../pages/src/calls.mjs';
import {Speaker, MIN_GAP_S} from '../pages/src/engine/speech.mjs';
import {directorCalls, roundIn, CALL_WORDS} from '../pages/src/ds-data.mjs';
import {PRIORITY} from '../pages/src/engine/director.mjs';

// data objects (ds-data.mjs) with just the meter states a call reads
const data = meters => ({v: 1, meters});
const attack = data({passing: {value: 2.5, state: 'too-slow'}});
const goWide = data({passing: {value: 2.5, state: 'go-wide'}});   // shown on the Passing meter, never called (0.34.0)
const blocked = data({blocked: {value: 40, state: 'blocked'}});
const alongside = data({blocked: {value: 60, state: 'blocked-right'}});
const defend = data({passing: {value: 2.0, state: 'rider-left'}});
const all = {chime: true, voice: true};

test('calls: your own pass first, then blocked, then being passed, then the tuck', () => {
    const mix = (...xs) => data(Object.assign({}, ...xs.map(x => x.meters)));
    assert.equal(dsCall(mix(blocked, attack)).id, 'pass');
    assert.equal(dsCall(mix(defend, blocked)).id, 'blocked');
    assert.equal(dsCall(alongside).state, 'right');
    assert.equal(dsCall(defend).id, 'passed');
    assert.equal(dsCall(data({passing: {value: 2, state: 'drop-back'}})).state, 'drop-back');
    assert.equal(dsCall(data({passing: {value: 0, state: 'none'}, blocked: {value: 0, state: 'clear'}})), null);
    assert.equal(dsCall({}), null);
    assert.equal(dsCall(null), null);
});

test('calls are the meters\' own words (docs/DS-DATA.md): active, a word or two, no numbers', () => {
    assert.equal(dsCall(attack).word, 'go harder');
    assert.equal(dsCall(goWide), null, '"go wide" is shown, never called');
    assert.equal(dsCall(data({passing: {value: 2.5, state: 'drop-back'}})).word, 'drop back');
    assert.equal(dsCall(blocked).word, 'ease off');
    assert.equal(dsCall(alongside).word, 'drop back');
    assert.equal(dsCall(defend).word, 'block left');
    assert.equal(dsCall(data({passing: {value: 1.5, state: 'rider-behind'}})).word, 'hold line');
    for (const d of [attack, blocked, alongside, defend]) {
        const c = dsCall(d);
        assert.ok(c.word.length <= 12, `"${c.word}" is short`);
        assert.doesNotMatch(c.word, /\d/);
        assert.equal(c.priority, CALL_PRIORITY[c.id]);
        assert.equal(c.in, null);
    }
});

test('the voice: the word, then the seconds when something is ahead', () => {
    assert.equal(callWords(dsCall(defend)), 'block left');
    assert.equal(callWords({word: 'steep', in: 24.6}), 'steep in 25');
});

test('units follow Sauce\'s imperial switch (help text)', () => {
    assert.equal(localizeUnits('closing at +2.5 km/h: go with 5+ km/h more, or go wide (1.5 m+)', true),
        'closing at +1.6 mph: go with 3+ mph more, or go wide (5 ft+)');
    assert.equal(localizeUnits('drop to 3–5 m, pull out wide', true), 'drop to 10–16 ft, pull out wide');
    assert.equal(localizeUnits('a 0.36 m/s gap, 0.30 m² CdA', true), 'a 0.36 m/s gap, 0.30 m² CdA', 'not m/s or m²');
});

test('delivery: per call type; the old voice switch carries over, being passed gets the chime alone', () => {
    const chimesOn = ['callGapChime', 'callTuckChime', 'callMoveUpChime', 'callSprintChime', 'callWheelChime',
                      'callPowerupChime', 'callCardChime'];
    // a fresh install: the main calls spoken, the same chimes (v0.43.0)
    const fresh = deliveryDefaults({});
    const voiceOn = ['callGapVoice', 'callPassVoice', 'callBlockedVoice', 'callMoveUpVoice', 'callPacingVoice',
                     'callSprintVoice', 'callPowerupVoice', 'callCardVoice', 'callSurfaceVoice'];
    assert.ok(Object.entries(fresh).every(([k, v]) => v === (chimesOn.includes(k) || voiceOn.includes(k))), JSON.stringify(fresh));
    assert.deepEqual(deliveryFor(fresh, 'passed'), {chime: false, voice: false}, 'being passed: nothing until chosen');
    assert.deepEqual(deliveryFor(fresh, 'wheel'), {chime: true, voice: false}, 'take the wheel: a chime only');
    // an existing install with its own choices (here: voice off everywhere): a new call type doesn't turn the voice on
    const off = deliveryDefaults({callPassVoice: false});
    assert.ok(Object.entries(off).every(([k, v]) => v === chimesOn.includes(k)),
        'an existing install: only the gap, tuck, move-up, finish, take-the-wheel, power-up and race card chimes are on');
    assert.equal(deliveryDefaults({speakCalls: false}).callGapVoice, false, 'the old switch off: stays off');
    const old = deliveryDefaults({speakCalls: true, speechChime: true});
    assert.deepEqual(deliveryFor(old, 'pass'), {chime: true, voice: true});
    assert.deepEqual(deliveryFor(old, 'passed'), {chime: true, voice: false});
    assert.deepEqual(deliveryFor(deliveryDefaults({speakCalls: true, speechChime: false}), 'blocked'),
        {chime: false, voice: true});
    assert.equal(deliveryKey('passed', 'chime'), 'callPassedChime');
    assert.equal(Object.keys(old).length, CALL_TYPES.length * DELIVERY.length, 'chime and voice (text went in 0.30.0)');
});

test('announcer: new calls only, one sound every 6 s, one per type every 30 s, the type\'s own chime', () => {
    const a = new Announcer();
    let t = 0;
    const p = a.offer(dsCall(defend), {chime: true, voice: false}, t);
    assert.deepEqual(p, {tones: CALL_TYPES.find(x => x.id === 'passed').tones, say: null});
    assert.equal(a.offer(dsCall(defend), {chime: true}, (t += 1000)), null, 'the same call still on');
    a.offer(null, null, (t += 1000));
    assert.equal(a.offer(dsCall(defend), {chime: true}, (t += MIN_GAP_S * 1000)), null, 'the same type inside 30 s');
    const b = a.offer(dsCall(blocked), all, t);
    assert.equal(b.say, 'ease off');
    assert.notDeepEqual(b.tones, p.tones, 'blocked has its own chime');
    assert.equal(a.offer(dsCall(attack), all, t + 1000), null, 'another call inside 6 s');
    assert.ok(a.offer(dsCall(attack), all, t + MIN_GAP_S * 1000), 'held back, then said while still on');
    a.offer(null, null, t);
    assert.ok(a.offer(dsCall(defend), {chime: true}, CALL_REPEAT_S * 1000 + 1), 'being passed again after 30 s');
    assert.equal(new Announcer().offer(dsCall(defend), {chime: false, voice: false}, 0), null, 'neither chime nor voice: no sound');
});

test('spoken: the shared Speaker says the words, with or without a chime (no audio in tests: nothing breaks)', () => {
    const said = [];
    const sp = new Speaker({synth: {cancel() {}, speak: u => said.push(u.text), getVoices: () => []},
                            Utterance: function (text) { this.text = text; }, AudioCtx: null});
    const s = new Announcer().offer(dsCall(blocked), all, 0);
    sp.utter(s.say, {chime: !!s.tones, tones: s.tones});
    assert.deepEqual(said, ['ease off']);
    assert.equal(sp.ding([660]), false, 'no AudioContext: no chime, no error');
    assert.equal(new Speaker({synth: null, Utterance: null}).utter('x'), null);
});

test('delivery grid: every checkbox sits in a label (Sauce saves a form field only from inside one)', () => {
    const html = deliveryGridHTML();
    const boxes = html.match(/<input [^>]*>/g);
    assert.equal(boxes.length, CALL_TYPES.length * DELIVERY.length);
    const inLabel = html.match(/<label[^>]*><input [^>]*><\/label>/g);
    assert.equal(inLabel.length, boxes.length);
    for (const t of CALL_TYPES) {
        for (const how of DELIVERY) assert.ok(html.includes(`name="${deliveryKey(t.id, how)}"`));
    }
});

test('supertuck call: fast enough but still pedaling -> "coast"; nothing when tucked or still building speed', () => {
    const tuck = state => data({tuck: {value: 0, state}});
    assert.deepEqual(dsCall(tuck('stop')), {id: 'tuck', state: 'stop', word: 'coast', in: null, for: null,
                                            priority: CALL_PRIORITY.tuck});
    assert.equal(dsCall(tuck('tuck')), null);
    assert.equal(dsCall(tuck('rest')), null, 'outside races the tuck is only a rest: no call');
    assert.equal(dsCall(data({tuck: {value: 3, state: 'build'}})), null);
    assert.equal(dsCall(data({...blocked.meters, tuck: {value: 0, state: 'stop'}})).id, 'blocked', 'pack calls first');
    const d = deliveryDefaults({speakCalls: true});
    assert.deepEqual(deliveryFor(d, 'tuck'), {chime: true, voice: false}, 'a chime only by default');
});

test('move up before a climb: the director\'s call joins the pack calls; the highest priority wins', () => {
    const climb = (state, secs) => directorCalls({moveUp: {state, secs, priority: PRIORITY[state]}});
    assert.deepEqual(climb('prep', 88.4), [{id: 'moveUp', state: 'prep', word: 'climb', in: 90, for: null, priority: 40}]);
    assert.equal(climb('move', 58)[0].word, 'move up');
    assert.equal(climb('move', 58)[0].in, null, '"move up" means now: no seconds');
    assert.equal(climb('hold', 40)[0].word, 'hold spot');
    assert.equal(climb('late', 30)[0].word, 'stay in line');
    assert.deepEqual(directorCalls({}), []);
    // move up (80) beats your pass (70); prep (40) loses to being passed (60)
    assert.equal(dsCall(attack, climb('move', 58)).id, 'moveUp');
    assert.equal(dsCall(defend, climb('prep', 90)).id, 'passed');
    assert.equal(dsCall(data({}), climb('prep', 90)).word, 'climb');
    assert.equal(callWords(dsCall(data({}), climb('prep', 88))), 'climb in 90');
    for (const w of Object.values(CALL_WORDS.moveUp)) assert.ok(w.length <= 12 && !/\d/.test(w), w);
    const d = deliveryDefaults({speakCalls: true});
    assert.deepEqual(deliveryFor(d, 'moveUp'), {chime: true, voice: true}, 'voice users hear it');
});

test('seconds in a call: to 5 s above 20 s, whole seconds below', () => {
    assert.equal(roundIn(88.4), 90);
    assert.equal(roundIn(22), 20);
    assert.equal(roundIn(12.6), 13);
    assert.equal(roundIn(-1), null);
    assert.equal(roundIn(NaN), null);
});

test('the finish: words, seconds to the line where they help, power-ups by Zwift\'s names, priorities from the coach', async () => {
    const {SPRINT_PRIORITY} = await import('../pages/src/engine/director.mjs');
    const sprint = (state, extra = {}) => directorCalls({sprint: {state, priority: SPRINT_PRIORITY[extra.p || state] ?? 80,
                                                                   toLineS: 118, remainingM: 1500, held: null, ...extra}});
    assert.deepEqual(sprint('position', {p: 'position'})[0], {id: 'sprint', state: 'position', word: 'top ten', in: 120,
                                                             for: null, priority: 85});
    assert.equal(sprint('good')[0].word, 'good spot');
    assert.equal(sprint('windup')[0].word, 'get a wheel');
    assert.equal(sprint('last')[0].word, 'last wheel, be ready');
    assert.equal(sprint('last-go', {p: 'windup'})[0].word, 'jump now');
    assert.deepEqual([sprint('keep-going', {p: 'keep'})[0].word, sprint('keep-going', {p: 'keep'})[0].in], ['keep going', null]);
    assert.equal(sprint('shake-left', {p: 'shake'})[0].word, 'drift left');
    // firing: the coach's own names; holding: Zwift's name and when to fire
    assert.deepEqual(sprint('fire-AERO', {p: 'fire'})[0], {id: 'powerup', state: 'fire-aero', word: 'AERO now', in: null,
                                                          for: null, priority: 95});
    assert.deepEqual([sprint('prep', {held: 'DRAFTBOOST'})[0].word, sprint('prep', {held: 'DRAFTBOOST'})[0].in], ['hold VAN', 80]);
    assert.equal(sprint('prep', {held: 'AERO'})[0].in, 105, '15 s to go');
    assert.equal(sprint('prep', {held: 'NINJA', toLineS: 60, remainingM: 1000})[0].in, 35, 'just before 400 m');
    assert.deepEqual([sprint('prep', {held: 'LIGHTNESS'})[0].word, sprint('prep', {held: 'LIGHTNESS'})[0].in],
        ['hold FEATHER', null], 'the feather: on your jump (it helps the acceleration)');
    assert.equal(sprint('fire-FEATHER', {p: 'fire'})[0].word, 'FEATHER now');
    for (const c of [sprint('position'), sprint('fire-BURRITO', {p: 'fire'}), sprint('prep', {held: 'UNDRAFTABLE'})].flat()) {
        assert.ok(c.word.length <= 12 && !/\d/.test(c.word), c.word);
    }
    // the finish outranks the pack calls; "keep going" (93) beats your own pass (70)
    assert.equal(dsCall(attack, sprint('keep-going', {p: 'keep'})).id, 'sprint');
    assert.equal(dsCall(defend, sprint('good')).id, 'passed', 'good spot (55) gives way to a rider creeping up (60)');
});

test('nudges: a habit worth changing, in a word; the lowest priority; voice only for voice users', async () => {
    const {NUDGE} = await import('../pages/src/engine/director.mjs');
    const nudge = state => directorCalls({nudge: {state, priority: NUDGE[state].priority}})[0];
    assert.deepEqual(nudge('wheel'), {id: 'nudge', state: 'wheel', word: 'ease off', in: null, for: null, priority: 20});
    assert.equal(nudge('middle').word, 'use edge');
    assert.equal(nudge('front').word, 'sit in');
    assert.equal(nudge('line').word, 'get in line');
    // everything else goes first: being passed (60), a climb's prep (40), the tuck (40)
    assert.equal(dsCall(defend, [nudge('middle')]).id, 'passed');
    assert.equal(dsCall(data({}), [nudge('middle')]).word, 'use edge');
    assert.deepEqual(deliveryFor(deliveryDefaults({}), 'nudge'), {chime: false, voice: false});
    assert.deepEqual(deliveryFor(deliveryDefaults({speakCalls: true}), 'nudge'), {chime: false, voice: true});
});
