/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Auto recording (v0.61.0): the Data Tap records every event you join, so a busy start can't skip it (user,
 * 2026-10-14: a TTT went unrecorded "with everything that was going on"). Pure (no DOM, no Sauce): the Data Tap feeds
 * it your own state on every tick and calls check() on a timer, and does what it answers.
 *
 *   start: you are in an event (your own eventSubgroupId), nothing is recording, and this event hasn't been
 *          auto-recorded yet (a Stop you press sticks for that event).
 *   stop:  only a recording it started, tailS after the event ended for you (you left the event, or crossed the
 *          finish), or after no data at all for idleS (Zwift closed: Sauce sends nothing, so no tick says so),
 *          or at once when you join a different event (that one starts on the next check).
 * A recording you start yourself is never stopped by it.
 * "Finished" counts only after you were seen with distance (or time) left in that event (`left` > 0): Sauce's
 * "remaining" is the event's end minus your distance, so an event with no set end (laps, open group rides) reads 0 or
 * less from the moment you join and looked finished at once, and was never recorded (2026-10-19, a group ride joined in
 * progress). why() says what it's waiting for, for the window's status line.
 * Race day (the user, 2026-10-19): into the pen 30 min early for a good spot, out to warm up, back in with a few minutes
 * to go. So: with the event's start known (`start`, ms), it waits until leadS before it (or the race moving); and an
 * event left before it got going isn't "done": back in the pen, it starts again. A Stop you press still sticks.
 * All the time (the user, 2026-10-23: a free ride on the TT bike after a group ride went unrecorded): with `always`,
 * a free-ride recording runs whenever your data comes (FREE_RIDE), stopped for an event's own recording when that
 * one is due (with `events`) and started again after it, and stopped when Zwift is gone. A Stop you press on a
 * free-ride recording sticks until you join or leave an event. Without `events`, one recording runs through events.
 */

export const AUTO_TAIL_S = 120;    // the finish, screen chat and the results come after the line
export const AUTO_IDLE_S = 300;    // no state of yours for this long: Zwift is gone
export const AUTO_LEAD_S = 300;    // start this long before the event's start (the pen, the line-up, the start)
export const AUTO_FRESH_S = 60;    // all the time: start only while your data is this fresh
export const FREE_RIDE = 'free';   // `owned` for an all-the-time recording

export class AutoRecord {
    constructor({tailS = AUTO_TAIL_S, idleS = AUTO_IDLE_S, leadS = AUTO_LEAD_S, events = true, always = false} = {}) {
        this.tailS = tailS;
        this.idleS = idleS;
        this.leadS = leadS;
        this.events = events;     // a recording of its own for every event
        this.always = always;     // and one all the time outside them
        this.freeStopped = false; // you stopped the all-the-time recording (until you join or leave an event)
        this.next = null;         // what the last 'start' was for: 'event' | 'free'
        this.start = null;        // the event's start: ms, null (not known: no wait) or 'pending' (being looked up: wait)
        this.moving = false;      // the race is under way for you (eventDistance > 0)
        this.raced = false;       // our recording saw the race under way (then the event is done for good)
        this.sg = null;           // your event now (null = free ride)
        this.finished = false;    // crossed this event's finish
        this.lastTickMs = null;   // your last state
        this.endMs = null;        // when the event ended for you
        this.owned = null;        // the event of the recording WE started (null = none)
        this.done = new Set();    // events already auto-recorded (or stopped by you): never again
        this.sawLeft = false;     // seen with distance / time left in this event
    }

    /*
     * Your own state, every tick: sg = state.eventSubgroupId, finished = crossed the event's finish, left = the event's
     * remaining (null / omitted: not known, finished is taken as it comes), start = the event's start (see this.start),
     * moving = the race under way for you.
     */
    tick(nowMs, {sg, finished = false, left, start = null, moving = false}) {
        this.start = start;
        this.moving = !!moving;
        if (sg && this.owned === sg && moving) this.raced = true;
        sg = sg || null;
        this.lastTickMs = nowMs;
        if (sg !== this.sg) {
            if (this.sg && this.endMs == null) this.endMs = nowMs;   // left the event
            this.sg = sg;
            this.finished = false;
            this.sawLeft = false;
            this.freeStopped = false;
        }
        if (Number.isFinite(left) && left > 0) this.sawLeft = true;
        if (left !== undefined && !this.sawLeft) finished = false;   // never seen before its end: no end at all
        if (sg && finished && !this.finished) {
            this.finished = true;
            if (this.owned === sg && this.endMs == null) this.endMs = nowMs;
        }
        if (sg && this.owned === sg && !this.finished) this.endMs = null;   // back in our event (a blip)
    }

    /* What to do now: 'start' | 'stop' | null. recording = anything recording (ours or yours). */
    check(nowMs, recording) {
        const idle = this.lastTickMs != null && nowMs - this.lastTickMs >= this.idleS * 1000;
        if (this.owned === FREE_RIDE) {
            if (!recording) {   // stopped by you
                this.owned = null;
                this.freeStopped = true;
                return null;
            }
            return idle || !this.always || this.eventDue(nowMs) ? 'stop' : null;
        }
        if (this.owned != null) {
            if (!recording) {   // stopped by you
                this.owned = null;
                return null;
            }
            const tail = this.endMs != null && nowMs - this.endMs >= this.tailS * 1000;
            const other = this.sg != null && this.sg !== this.owned;
            return idle || tail || other ? 'stop' : null;
        }
        if (recording) {
            if (this.sg) this.done.add(this.sg);   // your own recording covers it: a Stop you press stays stopped
            return null;
        }
        if (this.eventDue(nowMs)) {
            this.next = 'event';
            return 'start';
        }
        const fresh = this.lastTickMs != null && nowMs - this.lastTickMs < AUTO_FRESH_S * 1000;
        if (this.always && fresh && !this.freeStopped) {
            this.next = 'free';
            return 'start';
        }
        return null;
    }

    /* An event recording should run now: in an event, not finished, not recorded yet, past the wait. */
    eventDue(nowMs) {
        return !!(this.events && this.sg && !this.finished && !this.done.has(this.sg) && !this.waitMs(nowMs));
    }

    /* ms until it starts by itself (0 = now): before leadS ahead of the start, or the start still being looked up. */
    waitMs(nowMs) {
        if (this.moving) return 0;
        if (this.start === 'pending') return Infinity;
        return Number.isFinite(this.start) ? Math.max(0, this.start - this.leadS * 1000 - nowMs) : 0;
    }

    /* Why nothing starts (or what runs), for a status line. */
    why(recording, nowMs = Date.now()) {
        if (this.owned === FREE_RIDE) return 'recording all the time';
        if (this.owned != null) return 'recording this event';
        if (recording) return 'recording (yours)';
        if (this.always && this.freeStopped) return 'stopped by you (starts again at the next event)';
        if (this.always && (!this.events || !this.sg || this.finished || this.done.has(this.sg))) return 'waiting for Zwift data';
        if (!this.sg) return 'not in an event';
        if (this.finished) return 'this event is finished';
        if (this.done.has(this.sg)) return 'this event was recorded (or you stopped it)';
        const w = this.waitMs(nowMs);
        if (w === Infinity) return 'looking up the start…';
        if (w > 0) return `starts ${Math.round(this.leadS / 60)} min before the start, in ${Math.ceil(w / 60000)} min`;
        return 'starting…';
    }

    /* The Data Tap did it. */
    started() {
        if (this.next === 'free') {
            this.owned = FREE_RIDE;
            return;
        }
        this.owned = this.sg;
        this.done.add(this.sg);
        this.endMs = null;
        this.raced = this.moving;
    }

    /* Stopped by itself: an event left before it got going isn't done (back in the pen, it starts again). */
    stopped() {
        if (this.owned != null && this.owned !== FREE_RIDE && !this.raced) this.done.delete(this.owned);
        this.owned = null;
        this.endMs = null;
        this.raced = false;
    }
}
