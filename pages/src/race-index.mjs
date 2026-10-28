/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The race index: YouTube chapters for your OBS recording (the user, 2026-10-21: "I didn't see the DS save race index";
 * the Data Tap's chapters.mjs, synced as engine/chapters.mjs, does the YouTube rules). Pure: fed your own entry each
 * tick and the OBS record clock; the window saves the text when OBS stops.
 *
 *   index.videoStart(startMs, me)          // OBS started recording at startMs (a new video: starts over)
 *   index.tick(nowMs, me, {card, jumped})  // your entry; the race card for the route; SprintCoach.jumped
 *   index.text()                           // the YouTube description block, or '' (fewer than 3 chapters)
 *   index.toJSON() / RaceIndex.from(json)  // kept across a window reopen mid-race
 *
 * Moments: the race start (when the pen opens: RaceStartWatch), each race-card item passed (a climb also at its top),
 * 1.5 km to go, your jump, the finish. Only in an event, only while the video runs.
 */
import {ChapterLog, RaceStartWatch, raceRunning} from './engine/chapters.mjs';

export const FINISH_NEAR_M = 30;   // one tick at sprint speed

export class RaceIndex {
    constructor() {
        this.log = new ChapterLog();
        this.startWatch = new RaceStartWatch();
        this.startTitle = 'Start';
        this.ed = null;
        this.rem = null;
        this.jumped = false;
        this.onAdd = null;   // (title) => {}: the window drops an OBS chapter marker too
    }

    /* A new video. 0:00 is "In the pen" when it starts in an event before the race runs. */
    videoStart(startMs, me = null) {
        if (this.log.startMs != null && Math.abs(this.log.startMs - startMs) < 2000) return;   // the same video
        this.log.reset();
        this.log.start(startMs);
        const s = me && me.state;
        this.startTitle = s && s.eventSubgroupId && !raceRunning(me) ? 'In the pen' : 'Start';
        this.ed = this.rem = null;
        this.jumped = false;
    }

    get startMs() {
        return this.log.startMs;
    }

    add(ms, title, priority) {
        if (this.log.add(ms, title, priority) && this.onAdd) this.onAdd(title);
    }

    tick(nowMs, me, {card = null, jumped = false} = {}) {
        if (this.log.startMs == null || !me || !me.self || !me.state) return;
        const s = me.state;
        if (this.startWatch.update(me) && !this.log.items.some(i => i.title === 'Race start')) this.add(nowMs, 'Race start', 4);
        const ed = s.eventSubgroupId && Number.isFinite(s.eventDistance) && s.eventDistance > 1 ? s.eventDistance : null;
        if (card && Array.isArray(card.items) && ed != null && this.ed != null) {
            for (const it of card.items) {
                if (!(it.km > 0)) continue;
                const m = it.km * 1000;
                if (it.kind !== 'finish' && this.ed < m && ed >= m) {
                    this.add(nowMs, `${it.name}${it.scored ? ' (points)' : ''}`, it.scored ? 4 : 1);
                }
                const top = it.kind === 'climb' && it.lengthKm > 0 ? m + it.lengthKm * 1000 : null;
                if (top != null && this.ed < top && ed >= top) this.add(nowMs, `${it.name}: top`, 1);
            }
        }
        this.ed = ed;
        const rem = me.remainingType === 'event' && me.remainingMetric === 'distance' && Number.isFinite(me.remaining) ? me.remaining : null;
        if (rem != null && this.rem != null && this.rem > 1500 && rem <= 1500) this.add(nowMs, '1.5 km to go', 2);
        // the line: remaining reaches 0, or the event fields go with a few meters still showing (Spiral Summit
        // 2026-10-27: 1.2 m left, then no event: no Finish chapter)
        if (this.rem != null && this.rem > 0 && (rem != null ? rem <= 0 : this.rem <= FINISH_NEAR_M)) this.add(nowMs, 'Finish', 4);
        this.rem = rem;
        if (jumped && !this.jumped && ed != null) this.add(nowMs, 'Sprint: jump', 4);
        this.jumped = !!jumped;
    }

    text() {
        return this.log.youtube({startTitle: this.startTitle});
    }

    toJSON() {
        return {startMs: this.log.startMs, items: this.log.items, startTitle: this.startTitle};
    }

    /* A saved index (toJSON), or a fresh one (one "Race start" per video: tick drops a second). */
    static from(json) {
        const x = new RaceIndex();
        if (json && Number.isFinite(json.startMs)) {
            x.log.start(json.startMs);
            x.log.items = Array.isArray(json.items) ? json.items : [];
            x.startTitle = json.startTitle || 'Start';
        }
        return x;
    }
}
