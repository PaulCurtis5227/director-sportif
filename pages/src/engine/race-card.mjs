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
 *
 * Card: {cardVersion, id, name, route, date, format ('points', 'scratch'…: the race's, not the file's), items, …}.
 *
 * The format's contract. Riders keep card files and don't all update, so old and new must meet safely:
 *   - cardVersion is the text "x.y". y goes up with ANY change to the format; x only for an incompatible one, and the
 *     aim is that x never moves: the rules below can say nearly anything without it.
 *   - Older cards: every mod reads every older card, forever. No cardVersion = "1.0".
 *   - Unknown field, on the card or an item: ignored. For extras the item works without (an item's pacing: a mod
 *     without it still calls the sprint). A higher y is never a problem: the import just says some extras may go unused.
 *   - Unknown item: a kind this mod doesn't know, or `needs: ['feature']` naming one not in CARD_FEATURES: that item is
 *     skipped, the rest of the card is used, and the import says how many. For anything that would mislead if called
 *     half understood. The stored card keeps it, so updating the mod brings it back.
 *   - A higher x than CARD_VERSION's: the whole card is refused by name. The last resort, only when nothing in the card
 *     can be trusted. A card's x = the LOWEST x it needs, not the newest there is.
 *   - For whoever changes the format (protobuf's rules): a field never changes meaning and a name is never reused: a new
 *     meaning gets a new name. A new field is optional and the card must make sense without it.
 * Mods before v0.55.4 don't follow this: they ignore cardVersion and needs, and refuse a whole card over an unknown kind.
 *
 * 1.1 (v0.55.5): an item's segmentId (Zwift's id, as text), so a card works in a free ride: Sauce knows where that
 * segment is on the road (segment-live.mjs), and km means nothing outside the race. Older mods ignore it.
 * 1.2 (v0.55.6): pacing.start {waitAtM, goS, goW}: a standing start, stopped waitAtM before the banner (below 0), goS
 * seconds from "go" to the banner at goW. The director says go when the riders coming will catch you there.
 */

export const CARD_VERSION = '1.2';  // text: as a number, 1.10 would read as 1.1
export const CARD_FEATURES = [];   // the features this mod knows, for an item's `needs`
export const WARN_S = 70;          // a scored segment is called this long before it (at your speed)
export const ARCH_WARN_S = 40;     // an arch that gives a power-up
export const NOTE_S = 30;          // your note for an item
export const PACE_WARN_S = 15;     // a segment card's next effort is counted down from this far out
export const PACE_SHOW_S = 8;      // and stays on this long once it starts
export const PRIORITY = {pace: 79, contest: 75, position: 65, skip: 45, archUse: 72, archKeep: 50, note: 35};

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

const CARD_KINDS = ['sprint', 'kom', 'climb', 'arch', 'finish'];

/* "x.y" -> {x, y}; null if it can't be read. */
function parseVersion(v) {
    const m = typeof v === 'string' && /^([1-9]\d*)\.(\d+)$/.exec(v);
    return m ? {x: Number(m[1]), y: Number(m[2])} : null;
}

/* Same x, higher y: a card this mod reads whole, though it may hold extras this mod doesn't use. */
export function hasNewerExtras(card) {
    const v = parseVersion(card?.cardVersion ?? CARD_VERSION), mine = parseVersion(CARD_VERSION);
    return !!v && v.x === mine.x && v.y > mine.y;
}

/* Can this mod call this item? (the contract above) */
export function usableItem(it) {
    if (!it || !CARD_KINDS.includes(it.kind)) return false;
    return it.needs == null || (Array.isArray(it.needs) && it.needs.every(f => CARD_FEATURES.includes(f)));
}

export function validateCard(card) {
    const errors = [];
    if (!card || typeof card !== 'object') return ['not an object'];
    const version = parseVersion(card.cardVersion ?? '1.0');
    if (!version) errors.push('bad card version');
    else if (version.x > parseVersion(CARD_VERSION).x) errors.push(`card version ${card.cardVersion} needs a newer Director Sportif`);
    if (!card.id) errors.push('no id');
    if (!Array.isArray(card.items)) errors.push('no items');
    for (const it of (Array.isArray(card.items) ? card.items : []).filter(usableItem)) {
        if (it.km != null && !Number.isFinite(it.km)) errors.push(`bad km for ${it.name}`);
    }
    return errors;
}

/* The card to ride with: checked, only the items this mod can call, in order; skipped = how many it left out. */
export function readyCard(card, id = card?.id) {
    const errors = validateCard(card);
    if (errors.length) throw new Error(`race card ${id}: ${errors.join(', ')}`);
    const items = card.items.filter(usableItem).sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
    return {...card, items, skipped: card.items.length - items.length};
}

/* fetchJSON(url) -> object. Relative to this module, i.e. pages/race-cards/. */
export async function loadIndex(fetchJSON) {
    const idx = await fetchJSON(new URL('race-cards/index.json', import.meta.url).href);
    return Array.isArray(idx && idx.cards) ? idx.cards : [];
}

export async function loadCard(fetchJSON, entry) {
    return readyCard(await fetchJSON(new URL(`race-cards/${entry.file}`, import.meta.url).href), entry.id);
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
 * A segment card's plan (caffecter.com's segment cards; an item's `pacing.parts`: [{atM (from the banner) or fromLineM
 * (from the line), watts, forS, say}]) as race meters, in order. Anything malformed is left out: a card is a file.
 */
export function pacePoints(item) {
    const base = item.km * 1000, line = base + (Number(item.lengthKm) || 0) * 1000;
    const parts = Array.isArray(item.pacing?.parts) ? item.pacing.parts : [];
    return parts.map(p => ({...p, m: Number.isFinite(p.atM) ? base + p.atM : line - p.fromLineM}))
        .filter(p => Number.isFinite(p.m) && typeof p.say === 'string' && p.say).sort((a, b) => a.m - b.m);
}

/*
 * The pacing call now: "go in 10" counting down to the next effort, then its words ("go, 730") as it starts. Timed on
 * your own speed, since these are seconds to a jump. leadS: how far ahead of the spot to say it, so you're on the pedals
 * there, not a reaction later (the rider's own value). Null with nothing to say, and past the line.
 */
export function paceCall(it, {edM: at, v, leadS = 0}) {
    const points = pacePoints(it);
    const line = (it.km + (Number(it.lengthKm) || 0)) * 1000;
    if (!points.length || at >= line) return null;
    const speed = Math.max(v || 0, 4), edM = at + speed * leadS;
    const nowAt = points.findLastIndex(p => p.m <= edM);
    const key = itemKey(it);
    if (nowAt >= 0 && (edM - points[nowAt].m) / speed <= PACE_SHOW_S) {
        return {id: 'card', state: `pace-${key}-${nowAt}`, priority: PRIORITY.pace, about: 'pace', say: points[nowAt].say,
                text: `${it.name}: ${points[nowAt].say}`, item: it};
    }
    const next = points[nowAt + 1];
    if (next && (next.m - edM) / speed <= PACE_WARN_S) {
        const say = next.say.split(',')[0];
        return {id: 'card', state: `pace-${key}-${nowAt + 1}-prep`, priority: PRIORITY.pace, about: 'pace', say,
                text: `${it.name}: ${say} in ${Math.round(next.m - edM)} m`, item: it, toM: next.m - edM};
    }
    return null;
}

/*
 * A segment card's U-turn start, riding the road the other way: "U-turn in 10", then "U-turn" leadS ahead of the spot,
 * so the turn itself lands there. toTurnM: meters to the spot. Advice only, like every call: Zwift's turn is yours.
 */
export function uTurnCall(it, {toTurnM, v, leadS = 0}) {
    return spotCall(it, {toM: toTurnM, v, leadS, say: 'U-turn', tag: 'uturn'});
}

/* Something to do at a spot on the road ahead: "<say> in 10", then "<say>" leadS ahead of it. Null outside that. */
export function spotCall(it, {toM, v, leadS = 0, say, tag}) {
    if (!Number.isFinite(toM)) return null;
    const speed = Math.max(v || 0, 4), toPress = toM - speed * leadS, key = itemKey(it);
    const call = {id: 'card', priority: PRIORITY.pace, about: 'pace', say, item: it};
    if (toPress <= 0) return -toPress / speed <= PACE_SHOW_S ? {...call, state: `pace-${key}-${tag}`, text: `${it.name}: ${say}`} : null;
    if (toPress / speed > PACE_WARN_S) return null;
    return {...call, state: `pace-${key}-${tag}-prep`, text: `${it.name}: ${say} in ${Math.round(toPress)} m`, toM: toPress};
}

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
export function cardCall({card, plan = {}, edM, v, held, tt = false, leadS = 0}) {
    const none = {id: 'card', state: null, text: '', priority: 0};
    if (!card || !Number.isFinite(edM)) return none;
    const speed = Math.max(v || 0, 4);
    const calls = [];
    for (const it of card.items) {
        if (it.km == null) continue;
        const toM = it.km * 1000 - edM;
        // a segment card's plan: only if you're contesting it (your plan on the Race card tab)
        if (it.pacing && planFor(it, plan) === 'contest') {
            const pace = paceCall(it, {edM, v, leadS});
            if (pace) calls.push(pace);
        }
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
        // scored segments: one call ahead of them, with your plan; not once a segment card's effort has started ("sprint
        // in 1" while you're flat out)
        const going = it.pacing && p === 'contest' && pacePoints(it)[0]?.m <= edM;
        if (it.scored && it.kind !== 'finish' && toS <= WARN_S && !going) {
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
