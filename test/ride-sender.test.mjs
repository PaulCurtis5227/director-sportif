/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {RideSender, memorySendStore, minimizeText, sealBytes, gzipBytes, SEND_STATUS_KEY} from '../pages/src/ride-sender.mjs';
import {LINK_KEY} from '../pages/src/caffecter-link.mjs';

const subtle = globalThis.crypto.subtle;
const memStorage = () => {
    const m = new Map();
    return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)};
};
const linked = () => {
    const s = memStorage();
    s.setItem(LINK_KEY, JSON.stringify({site: 'staging', token: 'cfm_test', email: 'rider@example.com'}));   // release-scan-allow: a fake test token
    return s;
};

/* A site's key pair, and opening a sealed piece the way the site does (CFS1). */
async function siteKeys() {
    const kp = await subtle.generateKey({name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
                                        true, ['encrypt', 'decrypt']);
    const spki = Buffer.from(await subtle.exportKey('spki', kp.publicKey)).toString('base64');
    const open = async sealed => {
        const b = Buffer.from(sealed);
        assert.equal(b.subarray(0, 4).toString('latin1'), 'CFS1');
        const idLen = b[4], header = b.subarray(0, 5 + idLen);
        let p = 5 + idLen;
        const wl = (b[p] << 8) | b[p + 1];
        p += 2;
        const raw = await subtle.decrypt({name: 'RSA-OAEP'}, kp.privateKey, b.subarray(p, p + wl));
        p += wl;
        const iv = b.subarray(p, p + 12);
        const aes = await subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        return Buffer.from(await subtle.decrypt({name: 'AES-GCM', iv, additionalData: header}, aes, b.subarray(p + 12)));
    };
    return {key: {keyId: 'test-key', spki}, open};
}

/* A fake caffecter.com: takes pieces, answers done (409 with what's missing until all are there). */
function fakeSite(keys, {loseOnce = null} = {}) {
    const pieces = new Map(), calls = [];
    let lost = false, kept = null;
    const reply = (status, obj) => new Response(JSON.stringify(obj), {status});
    async function fetch(url, {method, headers, body}) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');   // as Chromium
        const u = new URL(url);
        calls.push(`${method} ${u.pathname}`);
        assert.equal(headers['x-caffecter-mod'], 'cfm_test');
        if (u.pathname === '/api/mod/key') return reply(200, keys.key);
        const ride = u.searchParams.get('ride');
        if (u.pathname === '/api/mod/ride/piece') {
            const n = Number(u.searchParams.get('n'));
            if (n === loseOnce && !lost) {   // stored, then lost on the site's side
                lost = true;
                return reply(200, {stored: n});
            }
            pieces.set(n, zlib.gunzipSync(await keys.open(Buffer.from(JSON.parse(body).data, 'base64'))).toString('utf8'));
            return reply(200, {stored: n});
        }
        if (u.pathname === '/api/mod/ride/done') {
            const count = Number(u.searchParams.get('count'));
            const missing = [];
            for (let n = 0; n < count; n++) if (!pieces.has(n)) missing.push(n);
            if (missing.length) return reply(409, {missing});
            kept = {ride, text: [...Array(count).keys()].map(n => pieces.get(n)).join('')};
            return reply(202, {state: 'joining'});
        }
        return reply(404, {});
    }
    return {fetch, calls, kept: () => kept};
}

const header = JSON.stringify({__capture: 1, format: 'capture-1.2', createdAt: 1, fields: [], meta: {}}) + '\n';
const tick = i => JSON.stringify({t: i, me: {athleteId: 388, self: true, athlete: {sanitizedFullname: 'Real Name', weight: 75, id: 388},
                                               state: {power: 200, heartrate: 150, athleteId: 388}}, r: [['x1', 1]]});
const piece = (from, to) => zlib.gzipSync(Array.from({length: to - from}, (_, i) => tick(from + i)).join('\n') + '\n');
const flushAll = async s => { while (s.running) await s.running; };

test('your own entry cut down before it leaves: name, Zwift id, heart rate out; others and the header as they were', () => {
    const out = minimizeText(header + tick(1) + '\nnot json\n');
    const [h, t] = out.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(h.__capture, 1);
    assert.deepEqual(t.me, {self: true, state: {power: 200}, athleteId: 'self', athlete: {weight: 75}});
    assert.deepEqual(t.r, [['x1', 1]]);
    assert.equal(out.trim().split('\n').length, 2, 'a line that does not read is left out');
});

test('a race: pieces sent as they come once it is in an event, the rest at Stop, done; a piece the site lost sent again', async () => {
    const keys = await siteKeys();
    const site = fakeSite(keys, {loseOnce: 2});
    const storage = linked();
    const s = new RideSender({store: memorySendStore(), fetch: site.fetch, storage, setTimeout: () => {}});
    const ride = await s.newRide();
    assert.match(ride, /^[0-9a-f]{32}$/);
    await s.addPiece(ride, 0, zlib.gzipSync(header));
    await s.addPiece(ride, 1, piece(0, 30));
    await flushAll(s);
    assert.equal(site.calls.length, 0, 'not in an event yet: nothing sent');
    await s.markSend(ride);
    await s.addPiece(ride, 2, piece(30, 60));
    await flushAll(s);
    await s.addPiece(ride, 3, piece(60, 90));
    await s.finish(ride, 4);
    await flushAll(s);
    const kept = site.kept();
    assert.ok(kept, 'the site has it all');
    const lines = kept.text.trim().split('\n');
    assert.equal(lines.length, 91, 'header + 90 ticks, in order, none twice');
    assert.deepEqual(lines.slice(1).map(l => JSON.parse(l).t), [...Array(90).keys()]);
    assert.ok(!kept.text.includes('Real Name') && !kept.text.includes('heartrate'));
    assert.ok(site.calls.filter(c => c.endsWith('/done')).length === 2, 'the first done found piece 2 missing; sent again, then done');
    assert.deepEqual(await s.store.rides(), [], 'the queue is empty');
    assert.match(JSON.parse(storage.getItem(SEND_STATUS_KEY)).text, /sent/);
});

test('never in an event: dropped at Stop, nothing sent; Sauce quit mid-race: finished and sent on the next open', async () => {
    const keys = await siteKeys();
    const site = fakeSite(keys);
    const store = memorySendStore();
    const s = new RideSender({store, fetch: site.fetch, storage: linked(), setTimeout: () => {}});
    const free = await s.newRide();
    await s.addPiece(free, 0, zlib.gzipSync(header));
    await s.finish(free, 1);
    assert.deepEqual(await store.rides(), []);
    // a race whose window closed before Stop (offline meanwhile: nothing went)
    const offline = new RideSender({store, fetch: async () => { throw new TypeError('Failed to fetch'); }, storage: linked(), setTimeout: () => {}});
    const race = await offline.newRide();
    await offline.markSend(race);
    await offline.addPiece(race, 0, zlib.gzipSync(header));
    await offline.addPiece(race, 1, piece(0, 30));
    await offline.addPiece(race, 2, piece(30, 60));
    await flushAll(offline);
    assert.equal((await store.rides()).length, 1, 'kept here while the site is out of reach');
    // the next open
    const next = new RideSender({store, fetch: site.fetch, storage: linked(), setTimeout: () => {}});
    await next.recover();
    await flushAll(next);
    assert.equal(site.kept().text.trim().split('\n').length, 61);
    assert.deepEqual(await store.rides(), []);
});

test('not linked: nothing sent, kept, and the status says why', async () => {
    const storage = memStorage();
    const store = memorySendStore();
    const s = new RideSender({store, fetch: async () => assert.fail('no call'), storage, setTimeout: () => {}});
    assert.equal(await s.newRide(), null, 'not linked: no ride to send');
    await store.putRide({ride: 'b'.repeat(32), site: 'staging', send: true, count: 2, createdAt: 1});
    await s.kick();
    assert.match(JSON.parse(storage.getItem(SEND_STATUS_KEY)).text, /not linked/);
    assert.equal((await store.rides()).length, 1);
});

test('the seal is the site\'s CFS1: opened with the private key, the key id bound in', async () => {
    const keys = await siteKeys();
    const sealed = await sealBytes(await gzipBytes('hello'), keys.key);
    assert.equal(zlib.gunzipSync(await keys.open(sealed)).toString(), 'hello');
    sealed[6] ^= 1;   // a changed key id: the open fails
    await assert.rejects(keys.open(sealed));
});
