/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Your races sent to your caffecter.com account while they record (v0.63.0; EfficiencyMeter docs/PLAN.md §25; the user,
 * 2026-11-09: "I finish the race, exit zwift, exit sauce. What happens if things are still in transit?").
 * With "Keep my races on caffecter.com" on and this copy linked (caffecter-link.mjs), every piece the recording stores
 * (engine/checkpoint.mjs, every 30 s: a gzip piece of lines) also goes into a send queue here (its own IndexedDB), and
 * from there to the site: your own entry cut down first (minimizeText: your name, Zwift id, profile, heart rate out, as
 * the report page does), then sealed with the site's public key (sealBytes: the site's CFS1 format), so only the site's
 * report function can open it. A recording is sent only once it has been in an event (markSend); one that never was
 * (a free ride, a segment pass) is dropped from the queue at Stop. At Stop the count is known: once every piece is
 * there, "done" (the site asks again for any it lacks, then joins them into a kept ride: Your saved rides). Pieces stay
 * here until the site has the whole ride; Sauce quit mid-send = sent the next time this window opens (recover()).
 *
 *   new RideSender({store, fetch, storage, setTimeout, random}).newRide() / addPiece(ride, n, gz) / markSend(ride) /
 *     finish(ride, count) / recover() / kick()
 *   memorySendStore() (tests) / idbSendStore() (the window)
 * Status for the settings window: localStorage SEND_STATUS_KEY {text, waiting, at}.
 */
import {readLink, siteUrl, MOD_HEADER} from './caffecter-link.mjs';

export const SEND_STATUS_KEY = 'director-sportif-send-status';
export const SEND = {retryS: 30};
export const MAGIC = 'CFS1';

/* ----- your own entry cut down (the same lists as caffecter.com's report page: what the reports read, nothing else) ----- */
export const KEEP_ATHLETE = ['weight', 'height', 'ftp'];
export const KEEP_ENTRY = ['watching', 'self', 'courseId', 'state', 'gap', 'gapDistance', 'isGapEst', 'remaining',
    'remainingMetric', 'remainingType', 'remainingEnd', 'gameState', 'eventSubgroupId', 'lapCount'];
export const DROP_STATE = ['heartrate', 'watchingAthleteId', 'athleteId', 'profileUpdatedAt'];

export function minimizeLine(x) {
    const me = x && x.me;
    if (!me) return x;
    const a = me.athlete || {};
    const out = Object.fromEntries(KEEP_ENTRY.filter(k => me[k] !== undefined).map(k => [k, me[k]]));
    out.athleteId = 'self';
    out.athlete = Object.fromEntries(KEEP_ATHLETE.filter(k => a[k] != null).map(k => [k, a[k]]));
    if (out.state) {
        out.state = {...out.state};
        for (const k of DROP_STATE) delete out.state[k];
    }
    x.me = out;
    return x;
}

/* A piece's text, each line cut down (the header passes as it is; a line that doesn't read is left out). */
export function minimizeText(text) {
    const out = [];
    for (const line of String(text).split('\n')) {
        if (!line) continue;
        let x;
        try {
            x = JSON.parse(line);
        } catch (e) {
            continue;
        }
        out.push(JSON.stringify(x && x.__capture ? x : minimizeLine(x)));
    }
    return out.length ? out.join('\n') + '\n' : '';
}

/* ----- gzip, gunzip, seal (Web Crypto: the browser, Electron and Node alike) ----- */
const streamBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export const gzipBytes = text => streamBytes(new TextEncoder().encode(text), new CompressionStream('gzip'));
export const gunzipText = async bytes => new TextDecoder().decode(await streamBytes(bytes, new DecompressionStream('gzip')));

const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

/*
 * The site's sealed format (caffecter site/js/seal.js): "CFS1" | key id length (1) | key id | wrapped key length (2,
 * big-endian) | the AES key wrapped with RSA-OAEP SHA-256 | IV (12) | AES-256-GCM ciphertext + tag, the header up to the
 * key id bound in as additional data.
 */
export async function sealBytes(bytes, {keyId, spki}, subtle = globalThis.crypto.subtle) {
    const id = new TextEncoder().encode(keyId);
    if (!id.length || id.length > 255) throw new Error('bad key id');
    const header = new Uint8Array(5 + id.length);
    header.set(new TextEncoder().encode(MAGIC), 0);
    header[4] = id.length;
    header.set(id, 5);
    const pub = await subtle.importKey('spki', b64ToBytes(spki), {name: 'RSA-OAEP', hash: 'SHA-256'}, false, ['encrypt']);
    const aes = await subtle.generateKey({name: 'AES-GCM', length: 256}, true, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const body = new Uint8Array(await subtle.encrypt({name: 'AES-GCM', iv, additionalData: header}, aes, bytes));
    const raw = new Uint8Array(await subtle.exportKey('raw', aes));
    const wrapped = new Uint8Array(await subtle.encrypt({name: 'RSA-OAEP'}, pub, raw));
    raw.fill(0);
    const out = new Uint8Array(header.length + 2 + wrapped.length + 12 + body.length);
    let p = 0;
    out.set(header, p); p += header.length;
    out[p++] = wrapped.length >> 8;
    out[p++] = wrapped.length & 0xff;
    out.set(wrapped, p); p += wrapped.length;
    out.set(iv, p); p += 12;
    out.set(body, p);
    return out;
}

/* ----- the queue: rides {ride, site, send, count, createdAt} and pieces {ride, n, bytes, sent} ----- */
export function memorySendStore() {
    const rides = new Map(), pieces = new Map();
    const k = (ride, n) => `${ride}:${String(n).padStart(6, '0')}`;
    return {
        rides: async () => [...rides.values()].map(r => ({...r})),
        putRide: async r => { rides.set(r.ride, {...r}); },
        removeRide: async ride => {
            rides.delete(ride);
            for (const key of [...pieces.keys()]) if (key.startsWith(`${ride}:`)) pieces.delete(key);
        },
        putPiece: async (ride, n, bytes, sent = false) => { pieces.set(k(ride, n), {n, bytes, sent}); },
        pieces: async ride => [...pieces.keys()].filter(x => x.startsWith(`${ride}:`)).sort().map(x => ({...pieces.get(x)})),
    };
}

const req = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
});
export function idbSendStore(name = 'ds-send') {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => {
            open.result.createObjectStore('rides', {keyPath: 'ride'});
            open.result.createObjectStore('pieces');
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    }));
    const tx = async (stores, mode, fn) => {
        const t = (await db()).transaction(stores, mode);
        const out = await fn(t);
        await new Promise((resolve, reject) => {
            t.oncomplete = resolve;
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
        return out;
    };
    const range = ride => IDBKeyRange.bound([ride, 0], [ride, Infinity]);
    return {
        rides: () => tx(['rides'], 'readonly', t => req(t.objectStore('rides').getAll())),
        putRide: r => tx(['rides'], 'readwrite', t => req(t.objectStore('rides').put(r))),
        removeRide: ride => tx(['rides', 'pieces'], 'readwrite', async t => {
            await req(t.objectStore('rides').delete(ride));
            await req(t.objectStore('pieces').delete(range(ride)));
        }),
        putPiece: (ride, n, bytes, sent = false) => tx(['pieces'], 'readwrite', t => req(t.objectStore('pieces').put({n, bytes, sent}, [ride, n]))),
        pieces: ride => tx(['pieces'], 'readonly', t => req(t.objectStore('pieces').getAll(range(ride)))),
    };
}

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

export class RideSender {
    /*
     * store: the queue. fetch, setTimeout: kept as plain functions and called as such (Chromium's throw "Illegal
     * invocation" when called on another object: v0.62.1). storage: localStorage (the link, the status).
     */
    constructor({store, fetch: fetchImpl = globalThis.fetch, storage = globalThis.localStorage, setTimeout: later = globalThis.setTimeout,
                 now = Date.now, random = n => globalThis.crypto.getRandomValues(new Uint8Array(n)), onStatus = null} = {}) {
        this.onStatus = onStatus;   // the window's own look at each status ({text, waiting}): the promise reminder (v0.64.0)
        this.store = store;
        this.fetchImpl = (...a) => fetchImpl(...a);
        this.later = (f, ms) => later(f, ms);
        Object.assign(this, {storage, now, random});
        this.running = null;
        this.again = false;
        this.retry = null;
        this.keys = new Map();   // site -> {keyId, spki}
    }

    status(text, waiting = 0) {
        try {
            this.storage.setItem(SEND_STATUS_KEY, JSON.stringify({text, waiting, at: this.now()}));
        } catch (e) { /* storage blocked: no status */ }
        if (this.onStatus) {
            try {
                this.onStatus({text, waiting});
            } catch (e) { /* the window's business */ }
        }
    }

    async newRide() {
        const link = readLink(this.storage);
        if (!link) return null;
        const ride = hex(this.random(16));
        await this.store.putRide({ride, site: link.site, send: false, count: null, createdAt: this.now()});
        return ride;
    }

    async _ride(ride) {
        return (await this.store.rides()).find(r => r.ride === ride) || null;
    }

    async addPiece(ride, n, bytes) {
        await this.store.putPiece(ride, n, bytes);
        if ((await this._ride(ride))?.send) this.kick();
    }

    /* The recording is in an event: send it (what's stored so far, then each piece as it comes). */
    async markSend(ride) {
        const r = await this._ride(ride);
        if (r && !r.send) await this.store.putRide({...r, send: true});
        this.kick();
    }

    /* Stopped: count pieces in all. Never in an event: dropped, nothing sent. */
    async finish(ride, count) {
        const r = await this._ride(ride);
        if (!r) return;
        if (!r.send) return this.store.removeRide(ride);
        await this.store.putRide({...r, count});
        this.kick();
    }

    /*
     * The window opened: a ride whose recording didn't stop properly (Sauce quit, a crash) is finished with the pieces
     * stored from the header on, in a row; then whatever is waiting is sent.
     */
    async recover() {
        for (const r of await this.store.rides()) {
            if (r.count != null) continue;
            if (!r.send) {
                await this.store.removeRide(r.ride);
                continue;
            }
            const ns = new Set((await this.store.pieces(r.ride)).map(p => p.n));
            let count = 0;
            while (ns.has(count)) count++;
            if (count < 2) await this.store.removeRide(r.ride);   // a header alone: nothing to keep
            else await this.store.putRide({...r, count});
        }
        this.kick();
    }

    /* Send what's waiting, now (one run at a time; a call during a run means run once more). */
    kick() {
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = (async () => {
            do {
                this.again = false;
                await this._pump().catch(e => {
                    this.status(`not sent yet, trying again: ${e && e.message ? e.message : e}`);
                    this._retryLater();
                });
            } while (this.again);
            this.running = null;
        })();
        return this.running;
    }

    _retryLater() {
        if (this.retry) return;
        this.retry = true;
        this.later(() => {
            this.retry = null;
            this.kick();
        }, SEND.retryS * 1000);
    }

    async _call(link, method, path, body = null) {
        const text = body == null ? '' : JSON.stringify(body);
        const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
        const headers = {[MOD_HEADER]: link.token, 'x-amz-content-sha256': hex(digest)};
        if (body != null) headers['content-type'] = 'application/json';
        const res = await this.fetchImpl(`${siteUrl(link.site)}${path}`, {method, headers, body: body == null ? undefined : text});
        let json = {};
        try {
            json = await res.json();
        } catch (e) { /* not JSON */ }
        return {status: res.status, json: json && typeof json === 'object' ? json : {}};
    }

    async _key(link) {
        if (this.keys.has(link.site)) return this.keys.get(link.site);
        const r = await this._call(link, 'GET', '/api/mod/key');
        if (r.status === 401) throw Object.assign(new Error('this Director Sportif is not linked any more'), {unlinked: true});
        if (r.status !== 200 || typeof r.json.spki !== 'string') throw new Error(`the site said ${r.status}`);
        this.keys.set(link.site, r.json);
        return r.json;
    }

    async _pump() {
        const waiting = (await this.store.rides()).filter(r => r.send);
        if (!waiting.length) return;
        const link = readLink(this.storage);
        if (!link) return this.status('not linked: link it again to send them', waiting.length);
        let sent = 0;
        for (const r of waiting) {
            if (r.site !== link.site) continue;   // linked to another site since: it waits for that one
            try {
                if (await this._sendRide(link, r)) sent++;
            } catch (e) {
                if (e.unlinked) return this.status('unlinked on caffecter.com: link it again to send them', waiting.length);
                throw e;
            }
        }
        const left = (await this.store.rides()).filter(r => r.send).length;
        this.status(left ? `sending: ${left} race${left > 1 ? 's' : ''} on the way` : sent ? 'sent: your race is in Your saved rides on caffecter.com' : '', left);
    }

    /* One ride: every piece not yet sent, then (count known) done. True once the site has it all. */
    async _sendRide(link, r) {
        const key = await this._key(link);
        for (const p of await this.store.pieces(r.ride)) {
            if (p.sent) continue;
            const sealed = await sealBytes(await gzipBytes(minimizeText(await gunzipText(p.bytes))), key);
            const res = await this._call(link, 'POST', `/api/mod/ride/piece?ride=${r.ride}&n=${p.n}`, {data: bytesToB64(sealed)});
            if (res.status === 401) throw Object.assign(new Error('not linked'), {unlinked: true});
            if (res.status === 400) {   // the site can't take this piece (too big, broken): the ride can't be whole
                await this.store.removeRide(r.ride);
                this.status(`a race couldn't be sent: ${res.json.error || 'a piece was refused'}`);
                return false;
            }
            if (res.status !== 200) throw new Error(`the site said ${res.status}`);
            await this.store.putPiece(r.ride, p.n, p.bytes, true);
            if (res.json.state === 'kept') break;   // the site has it already (an earlier answer lost)
        }
        if (r.count == null) return false;   // still recording
        const done = await this._call(link, 'POST', `/api/mod/ride/done?ride=${r.ride}&count=${r.count}`);
        if (done.status === 200 || done.status === 202) {
            await this.store.removeRide(r.ride);
            return true;
        }
        if (done.status === 401) throw Object.assign(new Error('not linked'), {unlinked: true});
        if (done.status === 409 && Array.isArray(done.json.missing)) {
            const have = new Map((await this.store.pieces(r.ride)).map(p => [p.n, p]));
            if (done.json.missing.some(n => !have.has(n))) {   // the site lacks a piece we never had: it can't be whole
                await this.store.removeRide(r.ride);
                this.status('a race couldn\'t be sent whole (a piece was lost on this computer)');
                return false;
            }
            for (const n of done.json.missing) await this.store.putPiece(r.ride, n, have.get(n).bytes, false);
            this.again = true;   // send those, then done again
            return false;
        }
        throw new Error(`the site said ${done.status}`);
    }
}
