/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The race card for the route you're racing (engine/race-card.mjs, the Data Tap's, synced with its cards in
 * engine/race-cards/): picked by itself from the event's route name (a card only speaks on its own route), with your
 * plan for it from the settings window (kept on this computer: the cards hold only course facts). Besides the cards
 * that ship with the mod, the rider can import cards (a file from caffecter.com's race card maker, or written by hand):
 * kept in the settings, used exactly like the shipped ones. Pure apart from the injected loaders.
 *
 *   new RaceCards({fetchJSON, routeName: routeId -> Promise of the route's name, planFor: cardId -> plan,
 *                  imported: () -> [card…]})
 *   .call(state, {held, v}) -> the card's call now (race-card.mjs cardCall, with what it's about) or null
 *   .sprintLine(state) -> the contested intermediate sprint line within 1 km: {toLineM, key} or null
 *   .refresh() -> look again (after an import)
 */

import {loadIndex, loadCard, cardForRoute, cardCall, sprintLineAhead, nextArchM, itemKey, validateCard} from './engine/race-card.mjs';

/* The cards to pick from: the shipped index's entries and the imported cards (entries carrying the card itself). */
export function cardEntries(shipped = [], imported = []) {
    return [...shipped, ...(imported || []).map(card => ({id: card.id, name: card.name, route: card.route, date: card.date,
                                                          imported: true, card}))];
}

/* An entry's card: an imported one is checked like a shipped one (race-card.mjs loadCard). */
export async function loadEntry(fetchJSON, entry) {
    if (!entry.card) return loadCard(fetchJSON, entry);
    const card = structuredClone(entry.card);
    const errors = validateCard(card);
    if (errors.length) throw new Error(`race card ${entry.id}: ${errors.join(', ')}`);
    card.items.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
    return card;
}

/*
 * A card file's text, imported: [the new list, message]. The card must pass the mod's own check and name its route
 * (cards only speak on their route); one with the same id replaces the old one (a card re-made for the same race).
 */
export function importCard(text, list = []) {
    let card;
    try {
        card = JSON.parse(text);
    } catch {
        throw new Error('not a race card file (not JSON)');
    }
    const errors = validateCard(card);
    if (!card || !card.route) errors.push('no route');
    if (errors.length) throw new Error(`not a usable race card: ${errors.join(', ')}`);
    const kept = (list || []).filter(c => c.id !== card.id);
    return [[...kept, card], `${kept.length < (list || []).length ? 'replaced' : 'imported'} ${card.name || card.id} (${card.route})`];
}

export class RaceCards {
    constructor({fetchJSON, routeName, planFor = () => ({}), imported = () => []}) {
        this.fetchJSON = fetchJSON;
        this.routeName = routeName;
        this.planFor = planFor;
        this.imported = imported;
        this.index = null;         // the shipped cards' index (loaded once)
        this.routeId = null;       // the route the card below is for
        this.card = null;          // the card for it, or null
    }

    /* Look for the card again on the next tick (an import or a removal). */
    refresh() {
        this.routeId = null;
    }

    /* Load the index once and the card for this route (once per route). */
    ensure(routeId) {
        if (routeId == null || routeId === this.routeId) return;
        this.routeId = routeId;
        this.card = null;
        const idx = this.index ? Promise.resolve(this.index) : loadIndex(this.fetchJSON).then(x => (this.index = x));
        Promise.all([idx, Promise.resolve().then(() => this.routeName(routeId))])
            .then(([entries, name]) => {
                const entry = cardForRoute(cardEntries(entries, this.imported()), name);
                return entry ? loadEntry(this.fetchJSON, entry) : null;
            })
            .then(card => {
                if (this.routeId === routeId) this.card = card;
            })
            .catch(e => console.warn('race card', e));
    }

    /* The card's call now (in an event only: its km are race distances), or null. */
    call(s, {held = null, v = 0, tt = false} = {}) {
        if (!s || !s.eventSubgroupId || s.routeId == null) return null;
        this.ensure(s.routeId);
        if (!this.card) return null;
        const c = cardCall({card: this.card, plan: this.planFor(this.card.id) || {}, edM: s.eventDistance, v, held, tt});
        return c && c.state ? c : null;
    }

    /* Meters to the next arch that gives a power-up (the feather looks no further), or null. */
    nextArch(s, {tt = false} = {}) {
        if (!s || !s.eventSubgroupId || s.routeId == null) return null;
        this.ensure(s.routeId);
        if (!this.card) return null;
        return nextArchM({card: this.card, plan: this.planFor(this.card.id) || {}, edM: s.eventDistance, tt});
    }

    sprintLine(s) {
        if (!s || !s.eventSubgroupId || s.routeId == null) return null;
        this.ensure(s.routeId);
        if (!this.card) return null;
        const l = sprintLineAhead({card: this.card, plan: this.planFor(this.card.id) || {}, edM: s.eventDistance});
        return l ? {toLineM: l.toLineM, key: itemKey(l.item)} : null;
    }
}
