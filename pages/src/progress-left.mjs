/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Distance to the finish when Sauce doesn't know it (v0.52.0; the user, 2026-10-31 Tour of Watopia stage 4: "The finish
 * was not called", and the race index had too few chapters to save). On Watopia's new roads Sauce has no length for the
 * route, so `remaining` is null all ride: no finish calls, no "1.5 km to go", no Finish chapter.
 *
 * Zwift's own state.progress is the share of the event ridden, in steps of 1/255; state.eventDistance is the meters
 * ridden in it. So the event's length = eventDistance / progress, read the moment progress steps (the tick it changes).
 * Measured (research: 2026-10-31 capture, the line at 54,144 m): 10–25 m off from 10% on; on the 10-27 race against
 * Sauce's own remaining: 1–13 m. Before PROGRESS_LEFT.minProgress the first steps are 100+ m off: no estimate.
 * Only for an event of one lap (or a distance): whether progress restarts each lap is not checked.
 *
 *   new ProgressLeft().fill(me, {laps}) -> me, or a copy with remaining / remainingMetric 'distance' / remainingType
 *   'event' and remainingEst true; laps = the event's laps (auto-record eventLapsOf: null for a distance event,
 *   undefined while not known yet: no estimate)
 */

export const PROGRESS_LEFT = {minProgress: 0.05};

export class ProgressLeft {
    constructor() {
        this.sg = null;
        this.p = null;       // progress at the last tick
        this.total = null;   // the event's length (m), from the last step
    }

    fill(me, {laps} = {}) {
        const s = me && me.state;
        if (!s || !s.eventSubgroupId) return me;
        if (s.eventSubgroupId !== this.sg) {
            this.sg = s.eventSubgroupId;
            this.p = this.total = null;
        }
        const p = s.progress, ed = s.eventDistance;
        if (Number.isFinite(p) && Number.isFinite(ed)) {
            if (this.p != null && p > this.p && p >= PROGRESS_LEFT.minProgress && p < 1) this.total = ed / p;
            this.p = p;
        }
        if (me.remaining != null || laps === undefined || laps > 1 || this.total == null || !Number.isFinite(ed)) return me;
        if (me.remainingType != null && me.remainingType !== 'event') return me;
        return {...me, remaining: this.total - ed, remainingMetric: 'distance', remainingType: 'event', remainingEst: true};
    }
}
