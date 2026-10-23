/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Broadcast (the video side of the mod, next to the Data Tap and the director sportif): chapters for the race
 * video. The moments the mod notices (race-card segments, splits, attacks, your jump, the finish, your event taps)
 * are collected against the time OBS started recording or streaming, then written as a
 * YouTube description block. YouTube ignores chapter markers inside the video file; it builds chapters from
 * description timestamps, with rules: the first is 0:00, at least 3, each chapter at least 10 s long.
 */

export const MIN_GAP_S = 10;
export const MAX_CHAPTERS = 20;

/* 0:00 / 7:05 / 1:02:03 */
export function stamp(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export class ChapterLog {
    constructor() {
        this.startMs = null;   // when the video started (OBS recording/stream), epoch ms
        this.items = [];       // [{ms, title, priority}]
    }

    start(epochMs) {
        if (this.startMs == null) this.startMs = epochMs;
    }

    reset() {
        this.startMs = null;
        this.items = [];
    }

    /*
     * priority: 4 = the race itself (start, points segments, your jump, the finish), 3 = a split, 2 = an attack,
     * 1.5 km to go, your event taps, 1 = course landmarks. A points sprint outranks a split within 10 s of it
     * (user, Urumaze 2026-10-06: the Shisa sprint chapter lost to "Split in the group").
     */
    add(epochMs, title, priority = 1) {
        if (this.startMs == null || !title) return false;
        this.items.push({ms: epochMs, title: String(title).replace(/\s+/g, ' ').trim().slice(0, 80), priority});
        return true;
    }

    /*
     * The YouTube list: 0:00 first, chapters at least MIN_GAP_S apart (when two collide the higher priority stays),
     * at most MAX_CHAPTERS (lowest priorities dropped first). Returns '' when there are fewer than 3.
     */
    youtube({startTitle = 'Start'} = {}) {
        if (this.startMs == null) return '';
        let list = this.items.map(x => ({...x, sec: (x.ms - this.startMs) / 1000})).filter(x => x.sec >= MIN_GAP_S)
            .sort((a, b) => a.sec - b.sec);
        // resolve collisions: walk in time order, keep the better of two too-close chapters
        const kept = [];
        for (const x of list) {
            const prev = kept.at(-1);
            if (prev && x.sec - prev.sec < MIN_GAP_S) {
                if (x.priority > prev.priority) kept[kept.length - 1] = x;
                continue;
            }
            kept.push(x);
        }
        list = kept;
        while (list.length > MAX_CHAPTERS - 1) {
            const minP = Math.min(...list.map(x => x.priority));
            const i = list.findIndex(x => x.priority === minP);
            list.splice(i, 1);
        }
        const out = [{sec: 0, title: startTitle}, ...list];
        if (out.length < 3) return '';
        return out.map(x => `${stamp(x.sec)} ${x.title}`).join('\n');
    }
}

/*
 * A split's chapter title (SplitWatch.confirmedNow entry): who is on which side, not just "split" — the Urumaze video
 * had six identical "Split in the group" chapters.
 */
export function splitTitle({where, front}) {
    const n = Number.isFinite(front) && front > 1 ? ` of ${front}` : '';
    return where === 'ahead' ? `Split: front group${n} gets away` : `Split: in the front group${n}`;
}

/*
 * The "Race start" chapter: when the pen opens, not when race distance starts counting. Zwift counts eventDistance
 * only from the start line, ~230 m / 27 s after the pen released at Urumaze 2026-10-06 (video 1:01 vs 1:28), and
 * there's no neutral start: that first stretch is already the race. Feed it your own entry each tick; it answers
 * true once per event: when you start rolling from a standstill in your event's pen, or when race distance starts
 * counting if the pen was never seen (Data Tap opened late).
 */
export class RaceStartWatch {
    constructor() {
        this.sg = null;
        this.inPen = false;
        this.done = false;
    }

    update(me) {
        const s = me && me.state;
        const sg = s && s.eventSubgroupId ? s.eventSubgroupId : null;
        if (sg !== this.sg) {
            this.sg = sg;
            this.inPen = false;
            this.done = false;
        }
        if (!sg || this.done) return false;
        const ed = Number.isFinite(s.eventDistance) ? s.eventDistance : 0;
        if (ed <= 1 && (s.speed || 0) < 1) this.inPen = true;
        if ((this.inPen && ed <= 1 && (s.speed || 0) > 3) || raceRunning(me)) {
            this.done = true;
            return true;
        }
        return false;
    }
}

/* ----- the race start (Broadcast starts OBS a little before it) ----- */

export const LEAD_CHOICES_S = [0, 30, 60, 90, 120, 180];   // 0 = start OBS with ● Record instead
export const DEFAULT_LEAD_S = 60;
export const START_WINDOW_S = 600;                         // don't start OBS for a race that began >10 min ago

/* Is it time to start OBS for a race scheduled at raceStartMs, leadS seconds early? */
export function obsStartDue(nowMs, raceStartMs, leadS) {
    if (!Number.isFinite(raceStartMs) || !(leadS > 0)) return false;
    return nowMs >= raceStartMs - leadS * 1000 && nowMs <= raceStartMs + START_WINDOW_S * 1000;
}

/*
 * The race is running, for YOUR entry (as eVelodrome's raceClock does): Sauce puts the event fields (remainingType
 * 'event', remaining, …) on every nearby entry for THAT rider's event, so only your own entry, in your own subgroup,
 * counts — a stranger's event on the same road once started eVelodrome's race (2026-07-29). Distance events: your race
 * distance has started counting; time events: elapsed = remainingEnd − remaining > 0.
 */
export function raceRunning(me) {
    const s = me && me.state;
    if (!s || !s.eventSubgroupId || me.remainingType !== 'event') return false;
    if (me.remainingMetric === 'time' && Number.isFinite(me.remainingEnd) && Number.isFinite(me.remaining)) {
        return me.remainingEnd - me.remaining > 0;
    }
    return Number.isFinite(s.eventDistance) && s.eventDistance > 1;
}

export const TAIL_CHOICES_S = [0, 60, 120, 180, 300];   // 0 = leave OBS running (stop it yourself)
export const DEFAULT_TAIL_S = 120;                      // screen chat and results come after the finish

/* Time to stop OBS: the race ended endMs and tailS seconds have passed. */
export function obsStopDue(nowMs, endMs, tailS) {
    return Number.isFinite(endMs) && tailS > 0 && nowMs >= endMs + tailS * 1000;
}

/* ----- rehearsal: a fake race to test Broadcast against real OBS without being in a race ----- */

export const REHEARSAL_PAD_S = 15;     // the fake race starts lead + this after you click
export const REHEARSAL_RACE_S = 90;    // and "ends" this long after its start
export const REHEARSAL_STEP_S = 15;    // one moment this often

/*
 * The fake race: {raceStartMs, endMs, moments: [{ms, title, priority}]}. Moments come from the race card's items when
 * one is given (in order), else generic ones; all fit between the start and the end.
 */
export function rehearsalPlan({nowMs, leadS, card = null}) {
    const raceStartMs = nowMs + (Math.max(0, leadS) + REHEARSAL_PAD_S) * 1000;
    const endMs = raceStartMs + REHEARSAL_RACE_S * 1000;
    const fromCard = card && Array.isArray(card.items) ?
        card.items.filter(it => it.km > 0).map(it => ({title: `${it.name}${it.scored && it.kind !== 'finish' ? ' (points)' : ''}`,
                                                     priority: it.scored || it.kind === 'finish' ? 4 : 1})) : [];
    const generic = [{title: 'Sprint (points)', priority: 2}, {title: 'Climb', priority: 1}, {title: splitTitle({where: 'behind', front: 12}), priority: 3},
                     {title: '1.5 km to go', priority: 2}, {title: 'Sprint: jump', priority: 4}];
    const list = (fromCard.length ? fromCard : generic).slice(0, Math.floor(REHEARSAL_RACE_S / REHEARSAL_STEP_S) - 1);
    const moments = [{ms: raceStartMs, title: 'Race start', priority: 4},
        ...list.map((m, i) => ({ms: raceStartMs + (i + 1) * REHEARSAL_STEP_S * 1000, ...m}))];
    return {raceStartMs, endMs, moments};
}
