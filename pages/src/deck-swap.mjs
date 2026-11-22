/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "A swap happened", from your Stream Deck (v0.71.0; the user, 2026-11-21: "In free rides you no longer need to be
 * stopped. Maybe we should make something in the stream deck tell the ds that a swap happened"). Your swap key's
 * multi-action gets one more step, a web request to Sauce on this PC (a plugin that sends GET requests, e.g. BarRaider's
 * API Ninja; Stream Deck's own Website action opens a browser tab instead):
 *   GET http://localhost:1080/api/rpc/v2/updateAthleteData/InNlbGYi/<base64url of {"dsSwap": 2}>
 * ("InNlbGYi" = "self"; 2 = the garage slot swapped with slot 1, 3 for the other key: kept in the recording only, the
 * DS can't know which bike is in which slot). Sauce merges it into your athlete data (stats.mjs updateAthleteData ->
 * userDefined, spread onto your own nearby entry), so the next tick carries dsSwap; the DS acts once and clears it
 * (updateAthleteData(self, {dsSwap: 0})). The action: the same toggle as the Swap button's "go" (bike <-> swapBike,
 * wheels <-> swapWheels) and the no-draft-means-TT watch starts over.
 * A dsSwap already set when the DS starts (pressed while it was closed) is stale: cleared, not acted on.
 * Pure: your nearby entry in, what to do out.
 *
 *   new DeckSwap().update(me) -> null | {slot, stale} (clear it either way; act only when !stale)
 */

export const DECK_SWAP_KEY = 'dsSwap';
export const DECK_URL_SELF = 'InNlbGYi';   // base64url of '"self"'

/* The URL for a Stream Deck key: slot = the garage slot your key swaps with slot 1 (2 or 3; any truthy value works). */
export function deckSwapUrl(slot = 2, {port = 1080} = {}) {
    const json = JSON.stringify({[DECK_SWAP_KEY]: slot});
    const b64 = (typeof btoa === 'function' ? btoa(json) : Buffer.from(json).toString('base64'))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `http://localhost:${port}/api/rpc/v2/updateAthleteData/${DECK_URL_SELF}/${b64}`;
}

export class DeckSwap {
    constructor() {
        this.seen = false;      // your first nearby entry looked at (a flag set before then is stale)
        this.clearing = false;  // a clear sent: the flag may still show for a tick or two
    }

    update(me) {
        if (!me || !me.self) return null;
        const v = me[DECK_SWAP_KEY];
        const first = !this.seen;
        this.seen = true;
        if (!v) {
            this.clearing = false;
            return null;
        }
        if (this.clearing) return null;   // our clear hasn't landed yet: not a second press
        this.clearing = true;
        return {slot: v, stale: first};
    }
}
