/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Race cards: the course facts of a race (format, scored segments, climbs, arches and what they give), loaded before
 * the race so the director can call them. Cards live in pages/race-cards/ (index.json lists them), so a git pull of the
 * mod updates them. The repo is PUBLIC, so a card holds only facts (from e.g. Zwift Insider's race guide); the rider's
 * own plan (contest / position / skip a segment, keep or use a power-up at an arch, notes) is stored locally in the
 * Data Tap settings per card and never committed.
 *
 * Item: {km (race distance from the start; null = unknown, no warning), kind: 'sprint'|'kom'|'climb'|'arch'|'finish',
 *        name, lengthKm?, grade?, scored?, gives?: 'AERO'|'RANDOM'|'XP'|'VAN'|'FEATHER'|…, info?}
 * Plan (local): {[itemKey]: {plan?: 'contest'|'position'|'skip', power?: 'use'|'keep', note?}}, itemKey = `${km}|${name}`.
 * plan = the scored segment; power = what to do with the power-up you hold at an arch that gives one (a sprint can
 * be both, like the Tower Sprint).
 */

export const WARN_S = 70;          // a scored segment is called this long before it (at your speed)
export const ARCH_WARN_S = 40;     // an arch that gives a power-up
export const NOTE_S = 30;          // your note for an item
export const PRIORITY = {contest: 75, position: 65, skip: 45, archUse: 72, archKeep: 50, note: 35};

export const PLANS_SEGMENT = ['contest', 'position', 'skip'];
export const PLANS_ARCH = ['use', 'keep'];
const PU = {AERO: 'AERO', DRAFTBOOST: 'van', LIGHTNESS: 'feather', NINJA: 'ghost', UNDRAFTABLE: 'burrito', BOOST: 'arrows',
            STEAMROLLER: 'steamroller', ANVIL: 'anvil'};

export const itemKey = item => `${item.km}|${item.name}`;

/*
 * A card only speaks on its own route: its km are race distances on that route, so on any other one every call is
 * at the wrong place (2026-10-08: the Urumaze card called sprints on a Sands and Sequoias group ride). Route names
 * from Sauce (rpc.getRoute(state.routeId).name) and the card's "route", compared without case or punctuation.
 */
export const routeKey = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function cardFitsRoute(card, routeName) {
    return !!(card && card.route && routeName) && routeKey(card.route) === routeKey(routeName);
}

/* The index entry for a route (index.json entries carry "route"); several -> the one dated nearest to now. */
export function cardForRoute(entries, routeName, now = Date.now()) {
    const fits = (entries || []).filter(e => cardFitsRoute(e, routeName));
    const dist = e => (e.date ? Math.abs(Date.parse(e.date) - now) : Infinity);
    return fits.sort((a, b) => dist(a) - dist(b))[0] || null;
}

export function validateCard(card) {
    const errors = [];
    if (!card || typeof card !== 'object') return ['not an object'];
    if (!card.id) errors.push('no id');
    if (!Array.isArray(card.items)) errors.push('no items');
    for (const it of card.items || []) {
        if (it.km != null && !Number.isFinite(it.km)) errors.push(`bad km for ${it.name}`);
        if (!['sprint', 'kom', 'climb', 'arch', 'finish'].includes(it.kind)) errors.push(`bad kind for ${it.name}`);
    }
    return errors;
}

/* fetchJSON(url) -> object. Relative to this module, i.e. pages/race-cards/. */
export async function loadIndex(fetchJSON) {
    const idx = await fetchJSON(new URL('race-cards/index.json', import.meta.url).href);
    return Array.isArray(idx && idx.cards) ? idx.cards : [];
}

export async function loadCard(fetchJSON, entry) {
    const card = await fetchJSON(new URL(`race-cards/${entry.file}`, import.meta.url).href);
    const errors = validateCard(card);
    if (errors.length) throw new Error(`race card ${entry.id}: ${errors.join(', ')}`);
    card.items.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
    return card;
}

/* Segment plan (default: scored segments are contested) and power-up plan at an arch (default: use what you hold). */
export function planFor(item, plan = {}) {
    const p = plan[itemKey(item)] || {};
    return p.plan || (item.scored ? 'contest' : null);
}

export function powerFor(item, plan = {}) {
    const p = plan[itemKey(item)] || {};
    return p.power || 'use';
}

const label = name => PU[name] || (name ? String(name).toLowerCase() : 'nothing');

/*
 * The line of the intermediate sprint you're contesting, if it's within maxM: {toLineM, item} or null. A scored
 * sprint segment (not the finish, not a KOM) with your plan 'contest'; the line = its km + lengthKm.
 */
export function sprintLineAhead({card, plan = {}, edM, maxM = 1000}) {
    if (!card || !Number.isFinite(edM)) return null;
    let best = null;
    for (const it of card.items) {
        if (it.km == null || it.kind !== 'sprint' || !it.scored || planFor(it, plan) !== 'contest') continue;
        const toLineM = (it.km + (Number(it.lengthKm) || 0)) * 1000 - edM;
        if (toLineM > 0 && toLineM <= maxM && (!best || toLineM < best.toLineM)) best = {toLineM, item: it};
    }
    return best;
}

/*
 * Meters to the next arch that gives a power-up you'd take (your plan doesn't keep what you hold there), or null.
 * tt: on a TT bike EVERY arch takes the power-up you hold (Zwift swaps it for +10 XP, rarely +250; the user,
 * 2026-10-26: you get one on a TT bike by taking it on a road bike, then switching), so any arch, whatever the plan.
 */
export function nextArchM({card, plan = {}, edM, tt = false}) {
    if (!card || !Number.isFinite(edM)) return null;
    let best = null;
    for (const it of card.items) {
        if (it.km == null || !(it.km > 0) || it.kind !== 'arch' && !it.gives) continue;
        if (!tt && (!it.gives || it.gives === 'XP' || powerFor(it, plan) === 'keep')) continue;
        const toM = it.km * 1000 - edM;
        if (toM > 0 && (best == null || toM < best)) best = toM;
    }
    return best;
}

/*
 * The call for the race card right now. edM: your race distance (state.eventDistance, m); v: m/s; held: the power-up
 * in your pocket (gameState.availablePowerUp). Returns {id: 'card', state, priority, text} or a null call; a call also
 * says what it's about, for the Director Sportif's words and seconds: {about: 'segment' | 'line' | 'arch' | 'note',
 * item, plan, power, held, gives, note, toM (meters to the item's km), toEndM (to the end of a segment)}.
 */
export function cardCall({card, plan = {}, edM, v, held, tt = false}) {
    const none = {id: 'card', state: null, text: '', priority: 0};
    if (!card || !Number.isFinite(edM)) return none;
    const speed = Math.max(v || 0, 4);
    const calls = [];
    for (const it of card.items) {
        if (it.km == null) continue;
        const toM = it.km * 1000 - edM;
        // inside a scored segment (km = its start banner): count down to the line, where the sprint is decided
        // (user, 2026-10-06: the call ended at the banner, but the points come at the end of the timed segment)
        const toEndM = toM + (Number(it.lengthKm) || 0) * 1000;
        if (toM < 0 && toEndM > 0 && it.scored && it.kind !== 'finish') {
            const p = planFor(it, plan);
            if (p !== 'skip') {
                const what = it.kind === 'kom' ? 'KOM' : 'Sprint';
                calls.push({id: 'card', state: `seg-in-${itemKey(it)}-${p}`, priority: PRIORITY[p] || PRIORITY.contest,
                            text: `${what} line in ${Math.round(toEndM / 50) * 50} m${p === 'position' ? ': position only' : ''}`,
                            about: 'line', item: it, plan: p, toM, toEndM});
            }
        }
        if (toM < 0) continue;
        const toS = toM / speed;
        const p = planFor(it, plan);
        const where = toM >= 1000 ? `${(toM / 1000).toFixed(1)} km` : `${Math.round(toM / 50) * 50} m`;
        const note = (plan[itemKey(it)] || {}).note;
        // scored segments: one call ahead of them, with your plan
        if (it.scored && it.kind !== 'finish' && toS <= WARN_S) {
            const what = it.kind === 'kom' ? 'KOM' : 'Sprint';
            const tail = p === 'skip' ? 'skip it' : p === 'position' ? 'position only, no sprint' : 'contest';
            calls.push({id: 'card', state: `seg-${itemKey(it)}-${p}`, priority: PRIORITY[p] || PRIORITY.contest,
                        text: `${what} points in ${where}: ${it.name}, ${tail}${note ? ` (${note})` : ''}`,
                        about: 'segment', item: it, plan: p, note, toM, toEndM: toM + (Number(it.lengthKm) || 0) * 1000});
        }
        // arches that give a power-up: empty your pocket first, unless your plan keeps what you hold. On a TT bike any
        // arch takes it (nextArchM): use it before, whatever the plan
        const gives = it.gives && it.gives !== 'XP' ? it.gives : null;
        if (tt && (it.kind === 'arch' || it.gives) && it.km > 0 && toS <= ARCH_WARN_S && held) {
            calls.push({id: 'card', state: `arch-${itemKey(it)}-tt`, priority: PRIORITY.archUse,
                        text: `Arch in ${where} takes your ${label(held)} (TT bike): use it before`,
                        about: 'arch', item: it, power: 'use', held, gives: 'XP', note, toM});
        } else if (gives && it.km > 0 && toS <= ARCH_WARN_S && held) {
            const g = gives === 'RANDOM' ? 'a random power-up' : label(gives);
            if (powerFor(it, plan) === 'keep') {
                calls.push({id: 'card', state: `arch-${itemKey(it)}-keep`, priority: PRIORITY.archKeep,
                            text: `Arch in ${where} gives ${g}: keep your ${label(held)}${note ? ` (${note})` : ''}`,
                            about: 'arch', item: it, power: 'keep', held, gives, note, toM});
            } else {
                calls.push({id: 'card', state: `arch-${itemKey(it)}-use`, priority: PRIORITY.archUse,
                            text: `Arch in ${where} gives ${g}: use your ${label(held)} before it${note ? ` (${note})` : ''}`,
                            about: 'arch', item: it, power: 'use', held, gives, note, toM});
            }
        }
        // your own note for anything else (a climb, the finish), shortly before it
        if (note && !it.scored && !gives && toS <= NOTE_S) {
            calls.push({id: 'card', state: `note-${itemKey(it)}`, priority: PRIORITY.note, text: `${it.name} in ${where}: ${note}`,
                        about: 'note', item: it, note, toM});
        }
    }
    // a tie goes to the nearer line or banner: a lap segment holds a KOM and a sprint (Spiral Summit's Jarvis Lap,
    // 10.2–14.9 km), and its "line in 4000 m" mustn't drown them out
    const near = c => (c.about === 'line' ? c.toEndM : c.toM) ?? Infinity;
    calls.sort((a, b) => b.priority - a.priority || near(a) - near(b));
    return calls[0] || none;
}
