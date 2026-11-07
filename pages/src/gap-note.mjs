/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The note that Sauce has no gaps here (the user, 2026-11-02: "Add a note when we don't have sauce gaps that our results
 * are less precise. One button to clear it. Sort of like the HR."). The gaps then come from road-gaps.mjs. It is a fact
 * about the ride, not a problem to fix, so it has no voice and needs one "I know" per event (no repeats, whatever the
 * road does after that: docs in the memory of the noise budget). It stays up until pressed.
 *
 *   update(source ('sauce' | 'road' | 'none', the engine's gapSource), key (this event or this day), wt (ms)) -> show?
 */
export const GAP_NOTE = {showS: 10};   // this long without Sauce's gaps before it shows: a road's first seconds, a data blip

export class GapNote {
    constructor({acked = null} = {}) {
        this.acked = acked;     // the key it was last pressed for
        this.key = null;
        this.since = null;      // wt Sauce's gaps went
        this.open = false;
    }

    update(source, key, wt) {
        if (key !== this.key) {
            this.key = key;
            this.since = null;
            this.open = false;
        }
        if (this.acked === key) return false;
        if (source === 'sauce') this.since = null;
        else if (this.since == null) this.since = wt;
        if (this.since != null && wt - this.since >= GAP_NOTE.showS * 1000) this.open = true;
        return this.open;
    }

    ack() {
        this.acked = this.key;
        this.open = false;
    }
}
