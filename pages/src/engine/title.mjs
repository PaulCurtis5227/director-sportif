/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Fills title.html from its query string (title-card.mjs titleQuery) and the race card it names.
 */

import {parseTitleQuery, cardRows} from './title-card.mjs';
import {loadIndex, loadCard} from './race-card.mjs';

const fetchJSON = url => fetch(url, {cache: 'no-store'}).then(r => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
});

export async function main() {
    const p = parseTitleQuery(location.search);
    let card = null;
    if (p.cardId) {
        try {
            const entry = (await loadIndex(fetchJSON)).find(c => c.id === p.cardId);
            if (entry) card = await loadCard(fetchJSON, entry);
        } catch (e) {
            console.warn('race card', e);
        }
    }
    const $ = id => document.getElementById(id);
    $('event').textContent = p.eventName || (card && card.name) || 'Race day';
    const sub = [];
    if (p.subgroup) sub.push(`Category ${p.subgroup}`);
    if (card && card.route) sub.push(card.route);
    if (card && Number.isFinite(card.distanceKm)) sub.push(`${card.distanceKm} km`);
    if (card && card.format) sub.push(`${card.format} race`);
    if (p.startMs != null) sub.push(`start ${new Date(p.startMs).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`);
    $('sub').textContent = sub.join(' · ');
    $('kicker').textContent = p.rider ? `${p.rider} · race` : 'Race';
    const rows = cardRows(card, p.plan);
    if (rows.some(r => r.plan)) document.body.classList.add('has-plan');
    if (!rows.length) {
        $('course').hidden = true;
        return;
    }
    $('items').replaceChildren(...rows.map(r => {
        const li = document.createElement('li');
        li.dataset.kind = r.kindId;
        for (const [cls, text] of [['km', r.km], ['kind', r.kind], ['name', r.name], ['detail', r.detail], ['gives', r.gives], ['plan', r.plan]]) {
            const span = document.createElement('span');
            span.className = cls;
            span.textContent = text;
            li.appendChild(span);
        }
        return li;
    }));
    if (card.source) $('source').textContent = `Course facts: ${card.source.replace(/^https?:\/\//, '')}`;
    fit($('course'));
    addEventListener('resize', () => fit($('course')));
}

/* Shrink the rows until the whole course fits its panel (long cards). Redone when the page is resized. */
function fit(panel) {
    let size = 1.4;
    document.documentElement.style.setProperty('--row', `${size}vw`);
    while (panel.scrollHeight > panel.clientHeight + 1 && size > 0.8) {
        size -= 0.05;
        document.documentElement.style.setProperty('--row', `${size.toFixed(2)}vw`);
    }
}
