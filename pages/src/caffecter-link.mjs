/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Linked to your caffecter.com account (v0.62.0; EfficiencyMeter docs/PLAN.md §25): the device flow, as a TV signs in.
 * "Link to Caffecter" asks the site for a code, opens caffecter.com/link.html?code=… in your browser, and asks every few
 * seconds until you approve it there; the site then gives this copy a token (it never sees your password). The token can
 * only send rides to your account (not built yet: the next step) and ask who it's linked to; unlink here or on the site.
 *
 * Kept in this window's localStorage (LINK_KEY), not the settings form: {site, token, email, name, linkedAt}. Every
 * Sauce window shares that storage, other mods' windows too: the token can do no more than send rides, and the account
 * page shows and unlinks it.
 * The token goes in the X-Caffecter-Mod header (the site's CloudFront signs requests and owns Authorization); a body
 * goes with its SHA-256 (x-amz-content-sha256), which CloudFront needs to sign it.
 *
 *   linkStart({site, name, fetch}) -> {userCode, deviceCode, interval, expiresIn, verifyUrl} | {error}
 *   linkPoll({site, userCode, deviceCode, fetch}) -> {state: 'waiting' | 'linked' | 'denied' | 'expired' | 'error', ...}
 *   linkCheck(link, {fetch}) -> {linked: true, email} | {linked: false} (unlinked on the site) | {error} (offline)
 *   unlinkSelf(link, {fetch})
 *   new LinkFlow({fetch, open, storage, setTimeout, now}).start(site, name, onState) / .cancel()
 */
export const SITES = {www: 'https://www.caffecter.com', staging: 'https://staging.caffecter.com'};
export const DEFAULT_SITE = 'www';
export const LINK_KEY = 'director-sportif-caffecter-link';
export const MOD_HEADER = 'x-caffecter-mod';

export const siteUrl = site => SITES[site] || SITES[DEFAULT_SITE];

async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function call(fetchImpl, method, url, {body = null, token = null} = {}) {
    const text = body == null ? '' : JSON.stringify(body);
    const headers = {'x-amz-content-sha256': await sha256Hex(text)};
    if (body != null) headers['content-type'] = 'application/json';
    if (token) headers[MOD_HEADER] = token;
    let res;
    try {
        res = await fetchImpl(url, {method, headers, body: body == null ? undefined : text});
    } catch (e) {
        return {status: 0, json: {error: 'caffecter.com could not be reached (offline?)'}};
    }
    let json = {};
    try {
        json = await res.json();
    } catch (e) { /* not JSON */ }
    return {status: res.status, json: json && typeof json === 'object' ? json : {}};
}

export async function linkStart({site, name, fetch: fetchImpl = globalThis.fetch}) {
    const base = siteUrl(site);
    const r = await call(fetchImpl, 'POST', `${base}/api/mod/link`, {body: {name}});
    if (r.status !== 200 || typeof r.json.userCode !== 'string') return {error: r.json.error || `caffecter.com said ${r.status}`};
    return {...r.json, verifyUrl: `${base}/link.html?code=${encodeURIComponent(r.json.userCode)}`};
}

export async function linkPoll({site, userCode, deviceCode, fetch: fetchImpl = globalThis.fetch}) {
    const r = await call(fetchImpl, 'POST', `${siteUrl(site)}/api/mod/link/poll`, {body: {userCode, deviceCode}});
    if (r.status === 200 && typeof r.json.token === 'string') return {state: 'linked', token: r.json.token, email: r.json.email, name: r.json.name};
    if (r.status === 202) return {state: 'waiting'};
    if (r.status === 403) return {state: 'denied'};
    if (r.status === 410) return {state: 'expired'};
    return {state: 'error', error: r.json.error || `caffecter.com said ${r.status}`};
}

export async function linkCheck(link, {fetch: fetchImpl = globalThis.fetch} = {}) {
    if (!link || !link.token) return {linked: false};
    const r = await call(fetchImpl, 'GET', `${siteUrl(link.site)}/api/mod/me`, {token: link.token});
    if (r.status === 200 && r.json.linked) return {linked: true, email: r.json.email};
    if (r.status === 401) return {linked: false};
    return {error: r.json.error || `caffecter.com said ${r.status}`};
}

export async function unlinkSelf(link, {fetch: fetchImpl = globalThis.fetch} = {}) {
    if (!link || !link.token) return;
    await call(fetchImpl, 'DELETE', `${siteUrl(link.site)}/api/mod/me`, {token: link.token});
}

export function readLink(storage = globalThis.localStorage) {
    try {
        const v = JSON.parse(storage.getItem(LINK_KEY) || 'null');
        return v && typeof v.token === 'string' ? v : null;
    } catch (e) {
        return null;
    }
}
export function writeLink(link, storage = globalThis.localStorage) {
    if (link) storage.setItem(LINK_KEY, JSON.stringify(link));
    else storage.removeItem(LINK_KEY);
}

/*
 * One link attempt: start, open the page, ask every `interval` s until linked, turned down, run out or cancelled.
 * onState({state: 'starting' | 'code' | 'linked' | 'denied' | 'expired' | 'error' | 'cancelled', userCode?, email?, error?}).
 */
export class LinkFlow {
    constructor({fetch: fetchImpl = globalThis.fetch, open = () => {}, storage = globalThis.localStorage,
                 setTimeout: later = globalThis.setTimeout, now = Date.now} = {}) {
        // kept as plain functions, never called as this.later(…): Chromium's setTimeout and fetch throw "Illegal
        // invocation" when called on anything but the window (v0.62.1: the first wait threw, so the DS never asked
        // again and the approval was never collected; Node allows it, so the tests missed it)
        this.fetchImpl = (...a) => fetchImpl(...a);
        this.later = (f, ms) => later(f, ms);
        Object.assign(this, {open, storage, now});
        this.run = 0;
    }

    cancel() {
        this.run++;
    }

    async start(site, name, onState) {
        try {
            return await this._start(site, name, onState);
        } catch (e) {
            // whatever goes wrong says so, never a silent stop on "approve this code"
            return onState({state: 'error', error: e && e.message ? e.message : String(e)});
        }
    }

    async _start(site, name, onState) {
        const run = ++this.run;
        const live = () => run === this.run;
        onState({state: 'starting'});
        const s = await linkStart({site, name, fetch: this.fetchImpl});
        if (!live()) return;
        if (s.error) return onState({state: 'error', error: s.error});
        onState({state: 'code', userCode: s.userCode, verifyUrl: s.verifyUrl});
        try {
            await this.open(s.verifyUrl);
        } catch (e) { /* the code is on screen: they can type it at caffecter.com/link.html */ }
        const until = this.now() + (s.expiresIn || 600) * 1000;
        const wait = Math.max(2, s.interval || 5) * 1000;
        let fails = 0;
        while (live()) {
            await new Promise(r => this.later(r, wait));
            if (!live()) return;
            if (this.now() > until) return onState({state: 'expired'});
            const p = await linkPoll({site, userCode: s.userCode, deviceCode: s.deviceCode, fetch: this.fetchImpl});
            if (!live()) return;
            if (p.state === 'waiting') {
                fails = 0;
                continue;
            }
            if (p.state === 'error' && ++fails < 5) continue;   // a blip: keep asking
            if (p.state === 'linked') {
                const link = {site, token: p.token, email: p.email, name: p.name, linkedAt: this.now()};
                writeLink(link, this.storage);
                return onState({state: 'linked', email: p.email});
            }
            return onState(p);
        }
    }
}
