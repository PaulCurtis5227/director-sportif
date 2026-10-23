/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A minimal obs-websocket v5 client (OBS 28+: Tools -> WebSocket Server Settings): log in, start/stop recording,
 * drop chapter markers, hear when recording/streaming starts. Written here instead of vendoring obs-websocket-js:
 * it's only these few requests. Everything fails soft — OBS missing or closed must never break a ride.
 *
 * Protocol: server sends Hello (op 0, with authentication {challenge, salt} when a password is set); we answer
 * Identify (op 1, authentication = base64(sha256(base64(sha256(password + salt)) + challenge))); Identified (op 2);
 * requests are op 6 {requestType, requestId, requestData} -> op 7 RequestResponse; events are op 5.
 */

const OUTPUTS = 1 << 6;   // event subscription: output events (RecordStateChanged, StreamStateChanged)

async function sha256b64(text, subtle) {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s);
}

export async function authString(password, salt, challenge, subtle = globalThis.crypto && globalThis.crypto.subtle) {
    if (!subtle) throw new Error('no WebCrypto here: cannot log in to a password-protected OBS');
    const secret = await sha256b64(password + salt, subtle);
    return sha256b64(secret + challenge, subtle);
}

export class ObsClient {
    constructor({url = 'ws://127.0.0.1:4455', password = '', WebSocketCtor = globalThis.WebSocket, timeoutMs = 4000} = {}) {
        Object.assign(this, {url, password, WebSocketCtor, timeoutMs});
        this.ws = null;
        this.connected = false;
        this.pending = new Map();
        this.seq = 0;
        this.listeners = new Map();   // eventType -> Set(fn)
    }

    on(eventType, fn) {
        (this.listeners.get(eventType) || this.listeners.set(eventType, new Set()).get(eventType)).add(fn);
    }

    connect() {
        return new Promise((resolve, reject) => {
            let done = false;
            const fail = err => { if (!done) { done = true; reject(err); } try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } };
            const timer = setTimeout(() => fail(new Error('OBS did not answer (is its WebSocket server on?)')), this.timeoutMs);
            try {
                this.ws = new this.WebSocketCtor(this.url);
            } catch (e) {
                clearTimeout(timer);
                return fail(e);
            }
            this.ws.onerror = () => { clearTimeout(timer); fail(new Error(`cannot reach OBS at ${this.url}`)); };
            this.ws.onclose = () => {
                const was = this.connected;
                this.connected = false;
                if (was && this.onClose) {
                    try { this.onClose(); } catch (e) { /* ignore */ }
                }
                for (const {reject: rj} of this.pending.values()) rj(new Error('OBS closed'));
                this.pending.clear();
                clearTimeout(timer);
                fail(new Error('OBS closed the connection (wrong password?)'));
            };
            this.ws.onmessage = async ev => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                const {op, d} = msg;
                if (op === 0) {
                    const identify = {rpcVersion: 1, eventSubscriptions: OUTPUTS};
                    if (d && d.authentication) {
                        try {
                            identify.authentication = await authString(this.password || '', d.authentication.salt, d.authentication.challenge);
                        } catch (e) {
                            clearTimeout(timer);
                            return fail(e);
                        }
                    }
                    this.ws.send(JSON.stringify({op: 1, d: identify}));
                } else if (op === 2) {
                    clearTimeout(timer);
                    this.connected = true;
                    done = true;
                    resolve(d);
                } else if (op === 7) {
                    const p = this.pending.get(d.requestId);
                    if (!p) return;
                    this.pending.delete(d.requestId);
                    if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
                    else p.reject(new Error(`${d.requestType}: ${(d.requestStatus && d.requestStatus.comment) || 'failed'}`));
                } else if (op === 5) {
                    for (const fn of this.listeners.get(d.eventType) || []) {
                        try { fn(d.eventData || {}); } catch (e) { console.warn('obs listener', e); }
                    }
                }
            };
        });
    }

    call(requestType, requestData) {
        if (!this.connected || !this.ws) return Promise.reject(new Error('OBS not connected'));
        const requestId = `effm-${++this.seq}`;
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, {resolve, reject});
            this.ws.send(JSON.stringify({op: 6, d: {requestType, requestId, requestData}}));
            setTimeout(() => {
                if (this.pending.delete(requestId)) reject(new Error(`${requestType}: no answer`));
            }, this.timeoutMs);
        });
    }

    /* Closing on purpose: no onClose callback (that is for OBS going away). */
    close() {
        this.onClose = null;
        try { this.ws && this.ws.close(); } catch (e) { /* ignore */ }
        this.connected = false;
    }

    startRecord() { return this.call('StartRecord'); }
    stopRecord() { return this.call('StopRecord'); }
    recordStatus() { return this.call('GetRecordStatus'); }
    streamStatus() { return this.call('GetStreamStatus'); }
    /* OBS 30.2+, Hybrid MP4 recordings only; elsewhere OBS answers an error, which callers ignore. */
    chapter(name) { return this.call('CreateRecordChapter', {chapterName: String(name).slice(0, 80)}); }
}
