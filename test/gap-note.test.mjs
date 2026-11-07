/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {GapNote, GAP_NOTE} from '../pages/src/gap-note.mjs';

const S = GAP_NOTE.showS * 1000;

test('the note shows after a while without Sauce\'s gaps, not on a blip', () => {
    const n = new GapNote();
    assert.equal(n.update('sauce', 'a', 0), false);
    assert.equal(n.update('none', 'a', 1000), false);
    assert.equal(n.update('sauce', 'a', 2000), false);
    assert.equal(n.update('road', 'a', 3000), false);
    assert.equal(n.update('road', 'a', 3000 + S - 1), false);
    assert.equal(n.update('road', 'a', 3000 + S), true);
});

test('it stays until pressed, then is quiet for the event; a new event starts again', () => {
    const n = new GapNote();
    n.update('road', 'a', 0);
    assert.equal(n.update('road', 'a', S), true);
    assert.equal(n.update('sauce', 'a', S + 1000), true, 'still up on a road with gaps: it speaks about this ride');
    n.ack();
    assert.equal(n.update('sauce', 'a', S + 2000), false);
    assert.equal(n.update('road', 'a', S + 3000), false);
    assert.equal(n.update('road', 'a', 3 * S), false, 'one press, whatever the road does after');
    assert.equal(n.update('road', 'b', 4 * S), false);
    assert.equal(n.update('road', 'b', 5 * S), true);
});

test('a reopened window remembers the press; another event doesn\'t', () => {
    const n = new GapNote({acked: 'a'});
    n.update('road', 'a', 0);
    assert.equal(n.update('road', 'a', 2 * S), false);
    n.update('road', 'b', 2 * S);
    assert.equal(n.update('road', 'b', 4 * S), true);
});
