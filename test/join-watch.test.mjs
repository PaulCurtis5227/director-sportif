/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSignup, upcomingSignups, JoinWatch, joinWord, JOIN_HOLD_S, JOIN_TICK_S, ZWIFT_AHEAD_S, wordsBeforeNumber} from '../pages/src/join-watch.mjs';

const T0 = Date.UTC(2026, 10, 14, 13, 0);   // the race: 13:00
const events = [
    {id: 1, name: 'Not mine', ts: T0 - 600000, eventSubgroups: [{id: 11, ts: T0 - 600000, signedUp: false}]},
    {id: 2, name: 'Stage 2', ts: T0, eventSubgroups: [{id: 21, ts: T0, subgroupLabel: 'B', signedUp: false},
                                                         {id: 22, ts: T0 + 60000, subgroupLabel: 'C', signedUp: true}]},
    {id: 3, name: 'Later', ts: T0 + 3600000, eventSubgroups: [{id: 31, ts: T0 + 3600000, signedUp: true}]},
];

test('the next race you signed up for: your category\'s own start, within 30 min, not one long gone', () => {
    const n = nextSignup(events, T0 - 20 * 60000);
    assert.equal(n.eventId, 2);
    assert.equal(n.sgId, 22, 'your category');
    assert.equal(n.startMs, T0 + 60000, 'C starts a minute after B');
    assert.deepEqual(n.sgIds, [21, 22]);
    assert.equal(nextSignup(events, T0 - 40 * 60000), null, 'over 30 min out');
    assert.equal(nextSignup(events, T0 + 3 * 60000), null, 'started more than a minute ago; the next is an hour off');
    assert.equal(nextSignup(null, T0), null);
});

test('reminders at 3, 2, 1 min and 30 s, each once, held a few seconds, none once you are in (the user, 2026-11-14)', () => {
    const w = new JoinWatch(), next = nextSignup(events, T0 - 10 * 60000), start = next.startMs;
    const said = [];
    for (let s = 300; s >= 0; s--) {
        const r = w.update({now: start - s * 1000, next, mySg: null});
        if (r && (!said.length || said.at(-1).state !== r.state)) said.push({s, ...r});
    }
    assert.deepEqual(said.map(x => [x.s, x.word]), [[184, 'join in 3 minutes'], [124, 'join in 2 minutes'], [64, 'join in 1 minute'], [34, 'join now: 30 seconds']], 'on the countdown: ZWIFT_AHEAD_S + half a tick early (v0.71.1)');
    const w2 = new JoinWatch();
    assert.ok(w2.update({now: start - 180000, next, mySg: null}));
    assert.ok(w2.update({now: start - 180000 + (JOIN_HOLD_S - 1) * 1000, next, mySg: null}), 'still up');
    assert.equal(w2.update({now: start - 180000 + (JOIN_HOLD_S + 1) * 1000, next, mySg: null}), null, 'then gone');
    const w3 = new JoinWatch();
    assert.equal(w3.update({now: start - 120000, next, mySg: 22}), null, 'in the pen: nothing');
    assert.equal(w3.update({now: start - 120000, next, mySg: 21}), null, 'in another category of it: nothing either');
    const late = new JoinWatch();
    assert.equal(late.update({now: start - 45000, next, mySg: null}).word, 'join in 1 minute', 'opened late: the one just passed, once');
    assert.equal(late.update({now: start - 30000, next, mySg: null}).word, 'join now: 30 seconds');
    assert.equal(joinWord(180), 'join in 3 minutes');
});

test('two signups (a 7:00 and an 8:00): each in turn; still in the first when the next starts: "next event in …" (the user, 2026-11-14)', () => {
    const seven = Date.UTC(2026, 10, 14, 12, 0), eight = seven + 3600000;
    const evs = [{id: 7, name: '7:00', ts: seven, eventSubgroups: [{id: 70, ts: seven, signedUp: true}]},
                 {id: 8, name: '8:00', ts: eight, eventSubgroups: [{id: 80, ts: eight, signedUp: true}]}];
    const w = new JoinWatch();
    assert.equal(w.update({now: seven - 180000, next: upcomingSignups(evs, seven - 180000), mySg: null}).word, 'join in 3 minutes', 'the 7:00 first');
    // 7:57, still racing the 7:00 (sg 70): the 8:00 is next
    const at = eight - 180000;
    const list = upcomingSignups(evs, at);
    assert.deepEqual(list.map(x => x.eventId), [8], 'the 7:00 started over a minute ago');
    const r = w.update({now: at, next: list, mySg: 70});
    assert.equal(r.word, 'next event in 3 minutes');
    assert.equal(r.state, 'next-180');
    assert.equal(new JoinWatch().update({now: eight - 30000, next: list, mySg: 70}).word, 'next event: 30 seconds');
    assert.equal(new JoinWatch().update({now: eight - 60000, next: list, mySg: null}).word, 'join in 1 minute', 'out of the first: join');
    assert.equal(new JoinWatch().update({now: eight - 60000, next: list, mySg: 80}), null, 'in the 8:00 already');
    // in the 7:00's pen at 6:58 with the 8:00 also signed up: nothing for either yet
    assert.equal(new JoinWatch().update({now: seven - 120000, next: upcomingSignups(evs, seven - 120000), mySg: 70}), null);
    assert.equal(joinWord(120, true), 'next event in 2 minutes');
});

test("on Zwift's countdown (~3.5 s ahead of the listed start), and early by the time its number takes to reach you (the user, 2026-11-22: 3 or 4 seconds later than the zwift count down)", () => {
    assert.equal(wordsBeforeNumber('join in 2 minutes'), 2);
    assert.equal(wordsBeforeNumber('join now: 30 seconds'), 2);
    assert.equal(wordsBeforeNumber('next event in 3 minutes'), 3);
    assert.equal(wordsBeforeNumber('no number'), 2);
    const next = nextSignup(events, T0 - 10 * 60000), start = next.startMs;
    // chime 0.38 + voice 0.3 + 2 words × 0.33 + Audio delay 1 s = 2.34 s, half a tick more
    const lead = word => 0.38 + 0.3 + wordsBeforeNumber(word) * 0.33 + 1;
    const fired = [];
    const w = new JoinWatch();
    for (let ms = 300000; ms >= 0; ms -= 100) {
        const r = w.update({now: start - ms, next, mySg: null, leadS: lead});
        if (r && (!fired.length || fired.at(-1).state !== r.state)) fired.push({s: ms / 1000, ...r});
    }
    assert.deepEqual(fired.map(x => x.state), ['join-180', 'join-120', 'join-60', 'join-30']);
    for (const x of fired) assert.ok(Math.abs(x.s - (x.at + ZWIFT_AHEAD_S + 2.34 + JOIN_TICK_S)) < 0.11, `${x.state} at ${x.s}`);
    // no lead given, a negative or junk one: on Zwift's countdown (half a tick early at most), never later
    for (const leadS of [undefined, -5, 'x', () => NaN]) {
        const v = new JoinWatch();
        let at = null;
        for (let ms = 200000; ms >= 0 && at == null; ms -= 100) if (v.update({now: start - ms, next, mySg: null, leadS})) at = ms / 1000;
        assert.ok(at >= 180 + ZWIFT_AHEAD_S && at <= 180 + ZWIFT_AHEAD_S + JOIN_TICK_S + 0.01, `${leadS}: ${at}`);
    }
});
