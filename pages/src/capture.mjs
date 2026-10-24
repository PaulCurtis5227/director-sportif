/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Director Sportif's recording, in the capture format (docs/RECORDING.md): for other riders only where they were
 * and the draft they got, under a random id that is new for every recording; for you, everything (your own data).
 * Measured: ~3.5–6 MB an hour gzipped.
 *
 * File: NDJSON, gzipped. Line 1: {__capture: 1, format, createdAt, fields, meta}. Then one line per tick:
 *   {t (ms), me: your full nearby entry (or null while you watch someone else), r: [[id, ...values], ...], c?: call}
 *   values in the order of RIDER_FIELDS; a value that didn't change since that rider's last row is null, and trailing
 *   unchanged values are left off (readCapture puts them back).
 * Marks (the Mark button): {t, mark: kind}.
 * Video (OBS, video-clock.mjs): {t, video: {kind: 'record' | 'stream', event: 'start' | 'stop', startMs}}: when your
 * recording or stream started, so a moment becomes a link into the video (docs/RECORDING.md).
 * Pure (no DOM, no Sauce), with the same lines interface as the s4z recorder, so engine/checkpoint.mjs stores it
 * crash-safe.
 */

export const CAPTURE_FORMAT = 'capture-1';
export const RIDER_FIELDS = ['worldTime', 'roadId', 'reverse', 'roadCompletion', 'gapCm', 'roadPosition', 'speed100',
                             'draft', 'powerUp'];

/* One rider's values (docs/RECORDING.md): nothing about power, cadence, heart rate, body. */
export function riderValues(o) {
    const s = o.state;
    return [s.worldTime, s.roadId, s.reverse ? 1 : 0, s.roadCompletion, Math.round((o.gapDistance || 0) * 100),
            s.roadPosition, Math.round((s.speed || 0) * 100), Math.round(s.draft || 0), s.activePowerUp || 0];
}

const randomId = () => {
    const b = new Uint8Array(4);
    (globalThis.crypto && globalThis.crypto.getRandomValues) ? globalThis.crypto.getRandomValues(b) :
        b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};

export class CaptureRecorder {
    /* meta: anything about the ride worth keeping in the header (version, route, event…). */
    constructor({meta = {}, now = Date.now()} = {}) {
        this.startedAt = now;
        this.meta = meta;
        this._lines = [];        // lines not yet released (engine/checkpoint.mjs stores and releases them)
        this._released = 0;
        this.ids = new Map();    // athleteId -> random id (this recording only)
        this.prev = new Map();   // random id -> its last values
        this.ticks = 0;
    }

    _metaLine() {
        return JSON.stringify({__capture: 1, format: CAPTURE_FORMAT, createdAt: this.startedAt, fields: RIDER_FIELDS,
                               meta: this.meta});
    }

    _id(athleteId) {
        if (!this.ids.has(athleteId)) this.ids.set(athleteId, randomId());
        return this.ids.get(athleteId);
    }

    /* One nearby tick: entries = Sauce's list; call = the Director Sportif's call now (data object), if any. */
    tick(t, entries, call = null) {
        let me = null;
        const rows = [];
        for (const o of entries || []) {
            if (!o || !o.state) continue;
            if (o.self) {
                me = o;
                continue;
            }
            const id = this._id(o.athleteId);
            const v = riderValues(o);
            const p = this.prev.get(id);
            const out = p ? v.map((x, i) => (x === p[i] ? null : x)) : v;
            while (out.length && out.at(-1) === null) out.pop();
            this.prev.set(id, v);
            rows.push([id, ...out]);
        }
        const line = {t, me, r: rows};
        if (call) line.c = [call.id, call.state, call.in ?? null];
        this._lines.push(JSON.stringify(line));
        this.ticks++;
    }

    mark(t, kind) {
        this._lines.push(JSON.stringify({t, mark: kind}));
    }

    video(t, change) {
        this._lines.push(JSON.stringify({t, video: change}));
    }

    /* Your event (docs/CAPTURE.md): {sg, name, subgroup, type (Zwift's eventType: RACE, GROUP_RIDE…)} when it's known, {sg, place, finishers, started, timeMs} at the end. */
    event(t, info) {
        this._lines.push(JSON.stringify({t, event: info}));
    }

    /* engine/checkpoint.mjs: the first n lines are stored; drop them from memory. */
    releaseLines(n) {
        this._lines.splice(0, n);
        this._released += n;
    }
}

/*
 * A capture file's text back into ticks: {meta, ticks: [{t, me, riders: [{id, worldTime, roadId, …}], call}],
 * marks: [{t, mark}], videos: [{t, video}], events: [{t, event}]}. For the analysis and the tests.
 */
export function readCapture(text) {
    const lines = String(text).split('\n').filter(Boolean);
    const head = JSON.parse(lines[0]);
    if (!head.__capture) throw new Error('not a capture file');
    const fields = head.fields || RIDER_FIELDS;
    const last = new Map();
    const ticks = [], marks = [], videos = [], events = [];
    for (const l of lines.slice(1)) {
        const x = JSON.parse(l);
        if (x.mark) {
            marks.push(x);
            continue;
        }
        if (x.video) {
            videos.push(x);
            continue;
        }
        if (x.event) {
            events.push(x);
            continue;
        }
        const riders = (x.r || []).map(([id, ...vals]) => {
            const p = last.get(id) || [];
            const full = fields.map((_, i) => (vals[i] === undefined || vals[i] === null ? p[i] : vals[i]));
            last.set(id, full);
            return {id, ...Object.fromEntries(fields.map((f, i) => [f, full[i]]))};
        });
        ticks.push({t: x.t, me: x.me, riders, call: x.c || null});
    }
    return {meta: head.meta, fields, ticks, marks, videos, events};
}
