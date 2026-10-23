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
