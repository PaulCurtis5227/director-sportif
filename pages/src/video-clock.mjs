/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * When your video started, by the wall clock, so a moment in a recording becomes a link into it (docs/PLAN.md §4,
 * §11: reports link everyone's videos). Two clocks, because a YouTube stream's replay counts from the stream's start
 * and an uploaded recording from the recording's start. Fed by OBS (engine/obs-client.mjs events and status); pure.
 *
 *   clock.state('record' | 'stream', active, nowMs, durationMs?)  // an OBS event, or a status (durationMs = running for)
 *   clock.starts -> {record: ms | null, stream: ms | null}
 *   linkSeconds(momentMs, startMs) -> seconds into that video (for ?t=), or null before it started
 */

export class VideoClock {
    constructor() {
        this.starts = {record: null, stream: null};
    }

    /* Returns the change ({kind, event: 'start' | 'stop', startMs}) or null when nothing changed. */
    state(kind, active, nowMs, durationMs = null) {
        if (kind !== 'record' && kind !== 'stream') return null;
        if (active) {
            const startMs = Number.isFinite(durationMs) ? nowMs - durationMs : nowMs;
            if (this.starts[kind] != null && Math.abs(this.starts[kind] - startMs) < 2000) return null;   // already known
            this.starts[kind] = startMs;
            return {kind, event: 'start', startMs};
        }
        if (this.starts[kind] == null) return null;
        const startMs = this.starts[kind];
        this.starts[kind] = null;
        return {kind, event: 'stop', startMs};
    }
}

export const linkSeconds = (momentMs, startMs) =>
    Number.isFinite(momentMs) && Number.isFinite(startMs) && momentMs >= startMs ? Math.floor((momentMs - startMs) / 1000) : null;

/* OBS's output events say active / not with these states (obs-websocket v5). */
export const obsActive = d => !!(d && d.outputActive);

/*
 * What OBS will do with the race, for the window's OBS line (v0.45.0; the user, 2026-10-25: in the pen with nothing
 * saying OBS would start, they started it by hand). "Record OBS with the race" only. All times in ms; start = the
 * event's start (ms), null (not known: now) or 'pending' (being looked up). Returns the words or null.
 *   {withRace, rehearsing, recording (OBS), ours (we started it), stopAt, sg (null = the warm-up), ended (you finished),
 *    capturing (the DS recording runs), autoEvents, autoDone (this event's own recording done or stopped by you),
 *    start, leadMs, connected, now}
 */
export const clockText = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function obsPlanText(o) {
    if (!o.withRace || o.rehearsing) return null;
    if (o.recording) return o.ours && o.stopAt != null ? `stops in ${clockText(Math.max(0, o.stopAt - o.now))}` : null;
    if (!o.sg || o.ended) return null;
    if (!o.capturing && (!o.autoEvents || o.autoDone)) return 'starts when you press Record';
    if (o.start === 'pending') return 'looking up the start…';
    const dueMs = Number.isFinite(o.start) ? o.start - o.leadMs - o.now : 0;
    const when = dueMs > 0 ? `in ${clockText(dueMs)}` : 'now';
    return o.connected ? `starts with the race ${when}` : `starts with the race ${when}, once connected`;
}
