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
 * The same note says when the event's organizer turned Sauce off (v0.72.1; the user, 2026-11-24 ZRL: "It looks like sauce
 * was not working for the race. I believe there is a way for a promoter to turn off sauce for the event"): a tag in the
 * event's description (SAUCE_OFF_TAGS, Sauce src/stats.mjs disabledByEvent) and Sauce sends an empty rider list for the
 * whole event (_computeNearby), only your own data. Shown at once, for the event, so a quiet director isn't read as broken.
 *
 *   update(source ('sauce' | 'road' | 'none', the engine's gapSource), key (this event or this day), wt (ms), off?) -> show?
 */
export const GAP_NOTE = {showS: 10};   // this long without Sauce's gaps before it shows: a road's first seconds, a data blip

/* the event tags that make Sauce drop every other rider for the event (Sauce's own list, src/stats.mjs) */
export const SAUCE_OFF_TAGS = ['nooverlays', 'hidethehud'];

/* The tag an event subgroup (Sauce rpc getEventSubgroup: allTags, the event's and the subgroup's) turns Sauce off with, else null. */
export function sauceOffTag(sg) {
    const tags = sg && Array.isArray(sg.allTags) ? sg.allTags.map(t => String(t).toLowerCase()) : [];
    return SAUCE_OFF_TAGS.find(t => tags.includes(t)) || null;
}

export class GapNote {
    constructor({acked = null} = {}) {
        this.acked = acked;     // the key it was last pressed for
        this.key = null;
        this.since = null;      // wt Sauce's gaps went
        this.open = false;
    }

    update(source, key, wt, off = false) {
        if (key !== this.key) {
            this.key = key;
            this.since = null;
            this.open = false;
        }
        if (this.acked === key) return false;
        if (off) return (this.open = true);   // the organizer's doing: nothing to wait for
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
