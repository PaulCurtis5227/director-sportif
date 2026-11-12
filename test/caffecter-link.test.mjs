/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {LinkFlow, linkCheck, readLink, LINK_KEY, MOD_HEADER, SITES} from '../pages/src/caffecter-link.mjs';

const memStorage = () => {
    const m = new Map();
    return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)};
};
const hex = s => crypto.createHash('sha256').update(s).digest('hex');

/* A fake caffecter.com: answers the poll with `answers` in turn; checks every request's body hash. */
function fakeSite(answers) {
    const seen = [];
    const fetch = async (url, {method, headers, body}) => {
        seen.push({url, method, headers, body});
        assert.equal(headers['x-amz-content-sha256'], hex(body || ''), 'CloudFront needs the body\'s hash');
        const reply = (status, obj) => new Response(JSON.stringify(obj), {status});
        if (url.endsWith('/api/mod/link')) return reply(200, {userCode: 'BCDF-GHJK', deviceCode: 'd'.repeat(43), interval: 5, expiresIn: 600});
        if (url.endsWith('/api/mod/link/poll')) return answers.length ? answers.shift() : reply(410, {state: 'expired'});
        if (url.endsWith('/api/mod/me')) return headers[MOD_HEADER] === 'cfm_ok' ? reply(200, {linked: true, email: 'rider@example.com'}) : reply(401, {linked: false});
        return reply(404, {});
    };
    return {fetch, seen};
}
const flowWith = (site, storage, opened = []) =>
    new LinkFlow({fetch: site.fetch, storage, open: url => opened.push(url), setTimeout: f => f(), now: () => 1e12});

test('linking: the code shown, the page opened, waiting, then the token kept', async () => {
    const r = (status, obj) => new Response(JSON.stringify(obj), {status});
    const site = fakeSite([r(202, {state: 'waiting'}), r(500, {}), r(202, {state: 'waiting'}),
                           r(200, {state: 'linked', token: 'cfm_ok', email: 'rider@example.com', name: 'PC'})]);   // release-scan-allow: a fake test token
    const storage = memStorage(), opened = [], states = [];
    await flowWith(site, storage, opened).start('staging', 'PC', s => states.push(s.state));
    assert.deepEqual(states, ['starting', 'code', 'linked'], 'a 500 in between is a blip, not the end');
    assert.deepEqual(opened, [`${SITES.staging}/link.html?code=BCDF-GHJK`]);
    assert.equal(JSON.parse(site.seen[0].body).name, 'PC');
    const link = readLink(storage);
    assert.equal(link.token, 'cfm_ok');
    assert.equal(link.site, 'staging');
    assert.deepEqual(await linkCheck(link, {fetch: site.fetch}), {linked: true, email: 'rider@example.com'});
    assert.equal(site.seen.at(-1).headers[MOD_HEADER], 'cfm_ok', 'the token in its own header, not Authorization');
    assert.deepEqual(await linkCheck({...link, token: 'cfm_gone'}, {fetch: site.fetch}), {linked: false}, 'unlinked on the site');   // release-scan-allow: a fake test token
});

test('turned down or run out: nothing kept', async () => {
    for (const [answer, end] of [[new Response('{}', {status: 403}), 'denied'], [new Response('{}', {status: 410}), 'expired']]) {
        const storage = memStorage(), states = [];
        await flowWith(fakeSite([answer]), storage).start('www', 'PC', s => states.push(s.state));
        assert.equal(states.at(-1), end);
        assert.equal(storage.getItem(LINK_KEY), null);
    }
});

test('offline: a plain error, never a throw', async () => {
    const states = [];
    const flow = new LinkFlow({fetch: async () => { throw new TypeError('Failed to fetch'); }, storage: memStorage(), setTimeout: f => f()});
    await flow.start('www', 'PC', s => states.push(s));
    assert.equal(states.at(-1).state, 'error');
    assert.match(states.at(-1).error, /could not be reached/);
    assert.ok('error' in await linkCheck({site: 'www', token: 'cfm_x'}, {fetch: async () => { throw new Error('x'); }}));
});

test('v0.62.1: setTimeout and fetch called the way Chromium allows (on nothing, never on the LinkFlow)', async () => {
    // Chromium: "Illegal invocation" when setTimeout / fetch run with `this` other than the window
    function strictTimer(f) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); f(); }
    const r = (status, obj) => new Response(JSON.stringify(obj), {status});
    const site = fakeSite([r(202, {state: 'waiting'}), r(200, {state: 'linked', token: 'cfm_ok', email: 'rider@example.com', name: 'PC'})]);   // release-scan-allow: a fake test token
    function strictFetch(...a) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return site.fetch(...a); }
    const states = [];
    await new LinkFlow({fetch: strictFetch, storage: memStorage(), setTimeout: strictTimer, now: () => 1e12}).start('www', 'PC', s => states.push(s.state));
    assert.deepEqual(states, ['starting', 'code', 'linked']);
});

test('anything thrown inside the flow ends as an error the window shows', async () => {
    const states = [];
    const flow = new LinkFlow({fetch: fakeSite([]).fetch, storage: memStorage(), setTimeout: () => { throw new TypeError('Illegal invocation'); }});
    await flow.start('www', 'PC', s => states.push(s));
    assert.equal(states.at(-1).state, 'error');
    assert.match(states.at(-1).error, /Illegal invocation/);
});
