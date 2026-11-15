/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Join reminders (v0.67.0; the user, 2026-11-14: "Events become visible on the screen 30 minutes before they start. This
 * is when you want to get into the pen. Then exit the ride (to get out of the pen). Then start a new ride somewhere. …
 * at about 5 minutes and 30 seconds before the event you get a pop up that says would you like to join … I click no. Then
 * I wait until about 1-2 minutes before the event to join. Sometimes I forget/almost forget to join. DS should give me 1
 * minute warnings starting at 3 minutes, with another one at 30 seconds.").
 *
 * The events you're signed up for come from Sauce (rpc.getCachedEvents(): Zwift's event feed, each category with its own
 * start, sg.ts, and signedUp for your account). Before the start of the one you're signed up for, while you're not in it
 * (your state's eventSubgroupId is none of that event's categories), a call at JOIN_AT_S seconds out: "join in 3
 * minutes", "join in 2 minutes", "join in 1 minute", "join now: 30 seconds". Each said once; once you're in, nothing.
 * Several signups (a 7:00 and an 8:00): each start in turn; the one you're in is skipped. Still in an event when the
 * next one starts (the user, 2026-11-14: "If you are in an event and the next one is starting give a call like next event
 * starting in xxx with the standard count downs"): "next event in 3 minutes" … "next event: 30 seconds".
 * Never joins for you (advice only). Pure: tested in Node.
 */
export const JOIN_AT_S = [180, 120, 60, 30];
export const JOIN_HOLD_S = 8;          // a reminder stays up this long (time for the voice to pick it up)
export const JOIN_LOOK_MS = 30 * 60 * 1000;   // events starting within this are looked at

/*
 * Your signed-up starts from Sauce's cached events, soonest first: [{eventId, name, sgId, label, startMs, sgIds (all of
 * that event's categories)}]. A category start passed more than a minute ago is over; one more than 30 min out isn't yet.
 */
export function upcomingSignups(events, nowMs) {
    const out = [];
    for (const ev of Array.isArray(events) ? events : []) {
        if (!ev || !Array.isArray(ev.eventSubgroups)) continue;
        for (const sg of ev.eventSubgroups) {
            if (!sg || !sg.signedUp) continue;
            const startMs = Number.isFinite(sg.ts) ? sg.ts : Number.isFinite(ev.ts) ? ev.ts : NaN;
            if (!Number.isFinite(startMs) || startMs < nowMs - 60000 || startMs > nowMs + JOIN_LOOK_MS) continue;
            out.push({eventId: ev.id, name: ev.name || null, sgId: sg.id, label: sg.subgroupLabel || null, startMs,
                      sgIds: ev.eventSubgroups.map(x => x && x.id).filter(x => x != null)});
        }
    }
    return out.sort((a, b) => a.startMs - b.startMs);
}

/* The soonest of them (or null). */
export const nextSignup = (events, nowMs) => upcomingSignups(events, nowMs)[0] || null;

/* The words for a reminder S seconds out; inEvent: you're riding another event (the next one is starting). */
export function joinWord(S, inEvent = false) {
    const what = inEvent ? 'next event' : 'join';
    if (S >= 120) return `${what} in ${Math.round(S / 60)} minutes`;
    if (S >= 60) return `${what} in 1 minute`;
    return inEvent ? `next event: ${S} seconds` : `join now: ${S} seconds`;
}

export class JoinWatch {
    constructor() {
        this.said = new Map();   // eventId -> the thresholds said
        this.last = null;        // {state, word, at (s out), until (ms)}
    }

    /*
     * now (ms), next (upcomingSignups, or one of them), mySg (your state's eventSubgroupId, or null). The first start you're
     * not in and that hasn't started. Returns {state: 'join-<S>' | 'next-<S>', word, at (s), startMs} while a reminder is
     * up, else null.
     */
    update({now, next, mySg}) {
        const list = Array.isArray(next) ? next : next ? [next] : [];
        next = list.find(x => !(mySg != null && x.sgIds.includes(mySg)) && now < x.startMs) || null;
        if (!next) {
            this.last = null;
            return null;
        }
        const left = (next.startMs - now) / 1000;
        const said = this.said.get(next.eventId) || this.said.set(next.eventId, new Set()).get(next.eventId);
        // the threshold just passed: the smallest JOIN_AT_S at or above the seconds left that hasn't been said
        const due = JOIN_AT_S.filter(S => left <= S && !said.has(S));
        if (due.length) {
            const S = Math.min(...due);
            for (const x of due) said.add(x);   // passed ones (the DS opened late) aren't said one after another
            const inEvent = mySg != null;   // riding another event: "next event in …"
            this.last = {state: `${inEvent ? 'next' : 'join'}-${S}`, word: joinWord(S, inEvent), at: S, startMs: next.startMs, until: now + JOIN_HOLD_S * 1000};
        }
        if (this.last && now > this.last.until) this.last = null;
        return this.last ? {state: this.last.state, word: this.last.word, at: this.last.at, startMs: this.last.startMs} : null;
    }
}
