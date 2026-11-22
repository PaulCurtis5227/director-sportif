/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DeckSwap, deckSwapUrl, DECK_SWAP_KEY} from '../pages/src/deck-swap.mjs';

test('the Stream Deck URL: Sauce\'s rpc v2, "self" and {dsSwap: slot} as base64url JSON', () => {
    const url = deckSwapUrl(2);
    assert.equal(url, 'http://localhost:1080/api/rpc/v2/updateAthleteData/InNlbGYi/eyJkc1N3YXAiOjJ9');
    const [self, upd] = url.split('/').slice(-2).map(x => JSON.parse(Buffer.from(x, 'base64url').toString()));
    assert.equal(self, 'self');
    assert.deepEqual(upd, {[DECK_SWAP_KEY]: 2});
    assert.match(deckSwapUrl(3, {port: 1081}), /^http:\/\/localhost:1081\/.*eyJkc1N3YXAiOjN9$/);
});

test('a swap from the Stream Deck: once per press, held until the clear lands; one set before the DS opened is stale', () => {
    const me = x => ({self: true, ...(x ? {[DECK_SWAP_KEY]: x} : {})});
    const d = new DeckSwap();
    assert.deepEqual(d.update(me(2)), {slot: 2, stale: true}, 'pressed while the DS was closed: clear, no trade');
    assert.equal(d.update(me(2)), null, 'the clear not landed yet');
    assert.equal(d.update(me(0)), null);
    assert.deepEqual(d.update(me(3)), {slot: 3, stale: false}, 'a press');
    assert.equal(d.update(me(3)), null);
    assert.equal(d.update(me(null)), null);
    assert.deepEqual(d.update(me(2)), {slot: 2, stale: false}, 'the next press');
    assert.equal(d.update({self: false, [DECK_SWAP_KEY]: 2}), null, 'only your own entry');
    assert.equal(new DeckSwap().update(me(null)) ?? 'none', 'none');
});
