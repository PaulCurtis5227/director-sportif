/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The race card for the route you're racing (engine/race-card.mjs, the Data Tap's, synced with its cards in
 * engine/race-cards/): picked by itself from the event's route name (a card only speaks on its own route), with your
 * plan for it from the settings window (kept on this computer: the cards hold only course facts). Later the cards come
 * from the website, one per route, fetched at event start (docs/PLAN.md §6). Pure apart from the injected loaders.
 *
 *   new RaceCards({fetchJSON, routeName: routeId -> Promise of the route's name, planFor: cardId -> plan})
 *   .call(state, {held, v}) -> the card's call now (race-card.mjs cardCall, with what it's about) or null
 *   .sprintLine(state) -> the contested intermediate sprint line within 1 km: {toLineM, key} or null
 */

import {loadIndex, loadCard, cardForRoute, cardCall, sprintLineAhead, itemKey} from './engine/race-card.mjs';

export class RaceCards {
    constructor({fetchJSON, routeName, planFor = () => ({})}) {
        this.fetchJSON = fetchJSON;
        this.routeName = routeName;
        this.planFor = planFor;
        this.index = null;         // the shipped cards' index (loaded once)
        this.routeId = null;       // the route the card below is for
        this.card = null;          // the card for it, or null
    }

    /* Load the index once and the card for this route (once per route). */
    ensure(routeId) {
        if (routeId == null || routeId === this.routeId) return;
        this.routeId = routeId;
        this.card = null;
        const idx = this.index ? Promise.resolve(this.index) : loadIndex(this.fetchJSON).then(x => (this.index = x));
        Promise.all([idx, Promise.resolve().then(() => this.routeName(routeId))])
            .then(([entries, name]) => {
                const entry = cardForRoute(entries, name);
                return entry ? loadCard(this.fetchJSON, entry) : null;
            })
            .then(card => {
                if (this.routeId === routeId) this.card = card;
            })
            .catch(e => console.warn('race card', e));
    }

    /* The card's call now (in an event only: its km are race distances), or null. */
    call(s, {held = null, v = 0} = {}) {
        if (!s || !s.eventSubgroupId || s.routeId == null) return null;
        this.ensure(s.routeId);
        if (!this.card) return null;
        const c = cardCall({card: this.card, plan: this.planFor(this.card.id) || {}, edM: s.eventDistance, v, held});
        return c && c.state ? c : null;
    }

    sprintLine(s) {
        if (!s || !s.eventSubgroupId || s.routeId == null) return null;
        this.ensure(s.routeId);
        if (!this.card) return null;
        const l = sprintLineAhead({card: this.card, plan: this.planFor(this.card.id) || {}, edM: s.eventDistance});
        return l ? {toLineM: l.toLineM, key: itemKey(l.item)} : null;
    }
}
