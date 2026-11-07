/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Director Sportif's recording, in the capture format (docs/RECORDING.md): for other riders where they were, the
 * draft they got, their power, and their weight and height once, under a random id that is new for every recording
 * (no names, Zwift ids, cadence, heart rate or FTP); for you, everything (your own data).
 * Measured: ~3.5–6 MB an hour gzipped before power (v0.56.0).
 *
 * File: NDJSON, gzipped. Line 1: {__capture: 1, format, createdAt, fields, meta}. Then one line per tick:
 *   {t (ms), me: your full nearby entry (or null while you watch someone else), r: [[id, ...values], ...], c?: call,
 *    b?: [[id, weightKg, heightCm], ...]}
 *   values in the order of the header's fields; a value that didn't change since that rider's last row is null, and
 *   trailing unchanged values are left off (readCapture puts them back). b: a rider's weight and height (null when
 *   Sauce has none, as for minors), on the tick they are first seen and again only if they change.
 *   'power' joined the fields in v0.56.0, 'x' and 'y' in v0.59.0: older files lack them, and their header's fields say so.
 * Marks (the Mark button): {t, mark: kind}.
 * Video (OBS, video-clock.mjs): {t, video: {kind: 'record' | 'stream', event: 'start' | 'stop', startMs}}: when your
 * recording or stream started, so a moment becomes a link into the video (docs/RECORDING.md).
 * Pure (no DOM, no Sauce), with the same lines interface as the s4z recorder, so engine/checkpoint.mjs stores it
 * crash-safe.
 */

// 'capture-1.1' (v0.56.0): others' power and body added. 'capture-1.2' (v0.59.0): others' x / y (cm, Zwift's world
// position: the same place the road fields give, in map terms; gaps on roads Sauce has no map for come from it,
// road-gaps.mjs, and a replay needs it). x.y like the race cards: y = fields added (older readers still read it),
// x = an incompatible change (aim: never). Readers go by the header's fields, not this name.
export const CAPTURE_FORMAT = 'capture-1.2';
export const RIDER_FIELDS = ['worldTime', 'roadId', 'reverse', 'roadCompletion', 'gapCm', 'roadPosition', 'speed100',
                             'draft', 'powerUp', 'power', 'x', 'y'];

/* One rider's values (docs/RECORDING.md): no cadence, heart rate, names or ids. */
export function riderValues(o) {
    const s = o.state;
    return [s.worldTime, s.roadId, s.reverse ? 1 : 0, s.roadCompletion, Math.round((o.gapDistance || 0) * 100),
            s.roadPosition, Math.round((s.speed || 0) * 100), Math.round(s.draft || 0), s.activePowerUp || 0,
            Math.round(s.power || 0), Number.isFinite(s.x) ? Math.round(s.x) : null, Number.isFinite(s.y) ? Math.round(s.y) : null];
}

/* A rider's body as Sauce gives it: [weightKg, heightCm], each null when hidden (minors have none). */
const num = x => (Number.isFinite(x) && x > 0 ? Math.round(x * 10) / 10 : null);
export const bodyOf = o => [num(o.athlete?.weight), num(o.athlete?.height)];

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
        this.bodies = new Map(); // random id -> its last [weightKg, heightCm] written
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
        const rows = [], bodies = [];
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
            const b = bodyOf(o), pb = this.bodies.get(id);
            if (!pb || pb[0] !== b[0] || pb[1] !== b[1]) {
                this.bodies.set(id, b);
                bodies.push([id, ...b]);
            }
        }
        const line = {t, me, r: rows};
        if (call) line.c = [call.id, call.state, call.in ?? null];
        if (bodies.length) line.b = bodies;
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
 * A capture file's text back into ticks: {meta, ticks: [{t, me, riders: [{id, worldTime, roadId, …, weight, height}],
 * call}], marks: [{t, mark}], videos: [{t, video}], events: [{t, event}]}. For the analysis and the tests. A rider's
 * weight and height are null until known (and always in files before v0.56.0).
 */
export function readCapture(text) {
    const lines = String(text).split('\n').filter(Boolean);
    const head = JSON.parse(lines[0]);
    if (!head.__capture) throw new Error('not a capture file');
    const fields = head.fields || RIDER_FIELDS;
    const last = new Map();
    const body = new Map();   // id -> [weightKg, heightCm]
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
        for (const [id, kg, cm] of x.b || []) body.set(id, [kg ?? null, cm ?? null]);
        const riders = (x.r || []).map(([id, ...vals]) => {
            const p = last.get(id) || [];
            const full = fields.map((_, i) => (vals[i] === undefined || vals[i] === null ? p[i] : vals[i]));
            last.set(id, full);
            const [weight, height] = body.get(id) || [null, null];
            return {id, ...Object.fromEntries(fields.map((f, i) => [f, full[i]])), weight, height};
        });
        ticks.push({t: x.t, me: x.me, riders, call: x.c || null});
    }
    return {meta: head.meta, fields, ticks, marks, videos, events};
}
