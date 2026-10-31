/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A teammate with no heart rate (the user, 2026-10-27, ZRL Spiral Summit: "My teammate didn't have a HR. In some races
 * that can DQ them"). Teammates = riders in your event subgroup with your team tag (Sauce's athlete.team, from the
 * name's "(Dinos)" or "[Dinos]"), or whose name holds it as a word: Sauce takes the FIRST bracket as the tag, so
 * "John(Porkie) Dinos" is team "Porkie" (Spiral Summit 2026-10-27). You are watched too, team tag or not. Said in the
 * pen, where a strap can still be paired, and in the race.
 *
 * Sticky until acknowledged (the user, 2026-10-28: "a sticky message that requires acknowledgement ... without a HR
 * he will be DQ'd or lose half points"): the window shows one "I know" button per rider missing (meters.mjs hrChecker);
 * A teammate acknowledged once is done for the event (the user, 2026-10-28: "If I see the message, I will tell the
 * rider. After that it is the rider's problem": a friend's strap on the fritz must not become pop-ups all race). You
 * get TEAM_HR.selfAcks: after an "I know" your own warning comes back only on a new dropout (heart rate back, then gone
 * again), until acknowledged that many times ("For me I will take a little bit more noise"; "If I click I know, and
 * nothing changes after that I don't want to see the message in two minutes").
 *
 * Heart rate is health data (CLAUDE.md, data protection): only whether a signal is there is read, live; nothing is
 * kept but the ids of riders without one (and the ones acknowledged, this event only), and the recording gets the call
 * type only (capture.mjs: id, state), no names.
 *
 *   update(entries, me, wt) -> null (not in an event, nobody to watch) or
 *       {state: 'missing' | 'back' | 'ok', names: [first names, not acknowledged], say: true while the call should sound,
 *        missing: [{id, name, self, acked}] everyone with no heart rate now}
 *   'missing': someone not acknowledged has had no heart rate for TEAM_HR.noneS; said when it starts (or someone new
 *   joins it) and every TEAM_HR.againS while it lasts; 'back': a rider who was missing has one again (said once).
 */

export const TEAM_HR = {
    noneS: 20,      // no heart rate this long = missing (a strap pairing, a dropout)
    backS: 10,      // a heart rate this long = back
    sayS: 15,       // a call stays on this long (the Announcer may hold it a few seconds)
    againS: 120,    // said again this often while it lasts (until acknowledged)
    selfAcks: 3,    // your own warning: acknowledged this many times, then quiet for the event (a teammate: once)
};

const tag = t => (typeof t === 'string' ? t.trim().toLowerCase() : '');
/* Your team tag as isTeammate() compares it ('' = none). */
export const teamTag = athlete => tag(athlete && athlete.team);
const nameOf = a => [a.fullname, a.sanitizedFullname, Array.isArray(a.name) ? a.name.join(' ') : a.name]
    .filter(x => typeof x === 'string').join(' ').toLowerCase();
/* Your team: the same tag, or your tag as a word in their name. */
export function isTeammate(athlete, myTeam) {
    if (!athlete || !myTeam) return false;
    if (tag(athlete.team) === myTeam) return true;
    const words = nameOf(athlete).split(/[^\p{L}\p{N}]+/u);
    return words.includes(myTeam);
}
const firstName = e => e.self ? 'you' : (e.athlete && ((e.athlete.sanitizedName && e.athlete.sanitizedName[0]) ||
    e.athlete.sanitizedFullname)) || 'teammate';

export class TeamHrWatch {
    constructor() {
        this.reset();
    }

    reset() {
        this.sg = null;
        this.noneSince = new Map();   // athleteId -> wt the heart rate went missing
        this.hrSince = new Map();     // athleteId -> wt it came (back)
        this.reported = new Set();    // ids said missing
        this.acks = new Map();        // athleteId -> {n, at}: acknowledged ("I know") n times, the last at wt
        this.reopened = new Set();    // ids shown again after an ack (yours): said once on coming back
        this.lastWt = -Infinity;
        this.sayUntil = -Infinity;
        this.saidAt = -Infinity;
        this.backNames = [];
        this.backUntil = -Infinity;
    }

    /* "I know" (times: restored after a window reopen): a teammate is done for the event; you, see TEAM_HR.selfAcks. */
    ack(id, times = 1) {
        const a = this.acks.get(id);
        this.acks.set(id, {n: (a ? a.n : 0) + times, at: this.lastWt});
        this.reopened.delete(id);
    }

    acked(id, self) {
        const a = this.acks.get(id);
        if (!a) return false;
        if (!self || a.n >= TEAM_HR.selfAcks) return true;
        return !(this.noneSince.get(id) > a.at);   // a new dropout since the ack: warn again
    }

    update(entries, me, wt) {
        const sg = me && me.state ? me.state.eventSubgroupId || null : null;
        const myTeam = tag(me && me.athlete && me.athlete.team);
        if (!sg) {
            if (this.sg) this.reset();
            return null;
        }
        if (sg !== this.sg) {
            this.reset();
            this.sg = sg;
        }
        this.lastWt = wt;
        const mates = (entries || []).filter(e => e && !e.self && e.state && e.state.eventSubgroupId === sg &&
            isTeammate(e.athlete, myTeam));
        const watched = me.self ? [me, ...mates] : mates;
        if (!watched.length) return null;
        const missing = [];
        const back = [];
        for (const e of watched) {
            const id = e.athleteId;
            if (e.state.heartrate > 0) {
                this.noneSince.delete(id);
                if (!this.hrSince.has(id)) this.hrSince.set(id, wt);
                if (this.reported.has(id) && wt - this.hrSince.get(id) >= TEAM_HR.backS * 1000) {
                    this.reported.delete(id);
                    if (!this.acks.has(id)) back.push(firstName(e));   // acknowledged: nothing more about them
                }
            } else {
                this.hrSince.delete(id);
                if (!this.noneSince.has(id)) this.noneSince.set(id, wt);
                if (wt - this.noneSince.get(id) >= TEAM_HR.noneS * 1000) missing.push(e);
            }
        }
        const open = missing.filter(e => !this.acked(e.athleteId, e.self));
        // new: never said, or yours back after an ack
        const fresh = open.some(e => !this.reported.has(e.athleteId) || (this.acks.has(e.athleteId) && !this.reopened.has(e.athleteId)));
        for (const e of missing) this.reported.add(e.athleteId);
        for (const e of open) if (this.acks.has(e.athleteId)) this.reopened.add(e.athleteId);
        if (open.length && (fresh || wt - this.saidAt >= TEAM_HR.againS * 1000)) {
            this.saidAt = wt;
            this.sayUntil = wt + TEAM_HR.sayS * 1000;
        }
        const list = missing.map(e => ({id: e.athleteId, name: firstName(e), self: !!e.self, acked: !open.includes(e)}));
        if (open.length) {
            return {state: 'missing', names: open.map(firstName), say: wt <= this.sayUntil, missing: list};
        }
        if (back.length) {
            this.backNames = back;
            this.backUntil = wt + TEAM_HR.sayS * 1000;
        }
        if (wt <= this.backUntil) return {state: 'back', names: this.backNames, say: true, missing: list};
        return {state: missing.length ? 'missing' : 'ok', names: [], say: false, missing: list};
    }
}

/* The call's words: "Nick: no heart rate", "Nick, Tim: no heart rate", "Nick: heart rate back". */
export function teamHrWord(x) {
    if (!x || !x.names || !x.names.length) return '';
    return `${x.names.join(', ')}: ${x.state === 'back' ? 'heart rate back' : 'no heart rate'}`;
}

/* The banner's line and button for one rider missing. */
export function hrAckText(m) {
    return m.self ? {text: 'You have no heart rate: pair your strap (some races disqualify for it)',
                     button: 'I know I have no HR'}
        : {text: `${m.name} has no heart rate: tell them (some races disqualify for it)`,
           button: `I know ${m.name} has no HR`};
}
