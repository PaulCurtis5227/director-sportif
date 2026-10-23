/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the Director Sportif's windows share: styles from the settings, the window sized to its tiles, and the
 * settings window's tile editor. Used by the meter window (meters.mjs) and the Grid (grid.mjs). Only Sauce's
 * mod-facing basics: settingsStore, setBackground, sanitize, rpc.resizeOwnWindow.
 */

import * as Common from '/pages/src/common.mjs';
import {SIZES, cleanTiles, moveTile, newTile} from './tiles.mjs';

const doc = document.documentElement;

/* Background, text size and columns from the settings. */
export function setStyles(settings, columns) {
    Common.setBackground(settings);
    // a fitted window has a fixed text size (meters.css html.fit-window); otherwise Sauce's: the window's width
    doc.classList.toggle('fit-window', settings.fitWindow !== false);
    doc.style.setProperty('--columns', columns);
    const scale = Number(settings.textScale);
    doc.style.setProperty('--text-scale', Number.isFinite(scale) && scale > 0 ? scale / 100 : 1);
}

/*
 * The window sized to the tiles (Sauce's resizeOwnWindow RPC): measured with the tiles at their natural width, so a
 * smaller text size gives a smaller window. growOnly: never shrink mid-ride (that would jump around).
 * extras(): elements above the tiles that count while shown (a banner, a status line).
 */
export function windowFitter(content, {extras = () => []} = {}) {
    let last = null;
    const measure = () => {
        doc.classList.add('measuring');
        const r = content.getBoundingClientRect();
        doc.classList.remove('measuring');
        let extra = 0;
        for (const el of extras()) {
            if (el && !el.hidden) extra += el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginTop || 0);
        }
        // Sauce's padding around the page (common.scss html padding: 2px)
        const cs = getComputedStyle(doc);
        const padW = parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
        const padH = parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0);
        // CSS pixels to window (screen) pixels, if the window is zoomed
        const zoom = window.innerWidth > 0 && window.outerWidth > 0 ? window.outerWidth / window.innerWidth : 1;
        return {w: Math.ceil((r.width + padW) * zoom), h: Math.ceil((r.height + extra + padH) * zoom)};
    };
    return {
        fit({growOnly = false} = {}) {
            const m = measure();
            if (!m.w || !m.h) return;
            if (growOnly && last && m.w <= last.w && m.h <= last.h) return;
            const size = growOnly && last ? {w: Math.max(m.w, last.w), h: Math.max(m.h, last.h)} : m;
            if (last && Math.abs(size.w - last.w) < 2 && Math.abs(size.h - last.h) < 2) return;
            last = size;
            Promise.resolve().then(() => Common.rpc.resizeOwnWindow(size.w, size.h, {constrainToDisplay: true}))
                .catch(e => console.warn('window resize failed', e));
        },
    };
}

/* One tile's markup: the name, the value and unit, the word (label) under them. */
export function tileEl(tile, mappingId) {
    const el = document.createElement('div');
    el.className = `tile ${tile.size}${tile.note ? '' : ' no-note'}`;
    el.dataset.field = mappingId;
    el.innerHTML = '<div class="key"></div>' +
        '<div class="reading"><span class="value"></span><abbr class="unit"></abbr></div>' +
        '<div class="label"></div><div class="sub-label"></div>';
    return el;
}

/* ----- settings windows ----- */

export const options = (list, def) => list
    .map(x => `<option value="${x.id}"${x.id === def ? ' selected' : ''}>${Common.sanitize(x.label)}</option>`)
    .join('');

function fieldOptions(groups, selected) {
    return groups.map(g => `<optgroup label="${Common.sanitizeAttr(g.title)}">` +
        g.fields.map(f => `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>` +
            `${Common.sanitize(f.name)}</option>`).join('') +
        '</optgroup>').join('');
}

function tileRow(t, i, n, groups) {
    const row = document.createElement('div');
    row.className = 'tile-row';
    row.dataset.id = t.id;
    const btn = (action, icon, title, disabled) =>
        `<div class="button${disabled ? ' disabled' : ''}" data-action="${action}" title="${title}"><ms>${icon}</ms></div>`;
    row.innerHTML = `
        <select name="field" title="Meter">${fieldOptions(groups, t.field)}</select>
        <select name="size" title="Size">${options(SIZES, t.size)}</select>
        <label class="note" title="Show the meter's word under the value">
            <input type="checkbox" name="note"${t.note ? ' checked' : ''}/>word</label>
        <input type="number" name="warn" class="range warn" step="any" title="Turns yellow at (empty = the meter's own)"
               placeholder="yellow" value="${t.warn ?? ''}"/>
        <input type="number" name="alarm" class="range alarm" step="any"
               title="Turns red at (empty = the meter's own; set it below yellow when low is bad)" placeholder="red" value="${t.alarm ?? ''}"/>
        <div class="button-group">
            ${btn('up', 'arrow_upward', 'Move up', i === 0)}
            ${btn('down', 'arrow_downward', 'Move down', i === n - 1)}
            ${btn('delete', 'close', 'Remove', false)}
        </div>`;
    return row;
}

/*
 * The tile list in a settings window (#tiles): pick, size, threshold, order, add, remove, reset. The list is the
 * window's 'tiles' setting; the window it belongs to reloads when it changes. groups: tiles.mjs fieldCatalog output;
 * defaults: the window's own starting tiles; addDefault: the field preselected under Add.
 */
export function initTileEditor(groups, {defaults, addDefault}) {
    const fieldIds = new Set(groups.flatMap(g => g.fields.map(f => f.id)));
    const listEl = document.querySelector('#tiles .tile-list');
    let tiles = cleanTiles(Common.settingsStore.get('tiles'), fieldIds, defaults);
    const save = () => Common.settingsStore.set('tiles', tiles);

    function render() {
        listEl.replaceChildren(...tiles.map((t, i) => tileRow(t, i, tiles.length, groups)));
        if (!tiles.length) {
            listEl.innerHTML = '<div class="empty">No meters yet.</div>';
        }
    }

    listEl.addEventListener('change', ev => {
        const row = ev.target.closest('.tile-row');
        const t = row && tiles.find(x => x.id === row.dataset.id);
        if (!t) return;
        if (ev.target.name === 'field') t.field = ev.target.value;
        if (ev.target.name === 'size') t.size = ev.target.value;
        if (ev.target.name === 'note') t.note = ev.target.checked;
        if (ev.target.name === 'warn' || ev.target.name === 'alarm') {
            const v = ev.target.value.trim();
            t[ev.target.name] = v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
        }
        save();
    });
    listEl.addEventListener('click', ev => {
        const btn = ev.target.closest('.button[data-action]');
        const row = btn && btn.closest('.tile-row');
        if (!row || btn.classList.contains('disabled')) return;
        const id = row.dataset.id;
        if (btn.dataset.action === 'delete') {
            tiles = tiles.filter(t => t.id !== id);
        } else {
            tiles = moveTile(tiles, id, btn.dataset.action === 'up' ? -1 : 1);
        }
        save();
        render();
    });
    const addSelect = document.querySelector('#tiles .add-tile select');
    addSelect.innerHTML = fieldOptions(groups, addDefault);
    document.querySelector('#tiles .add-tile input[type="button"]').addEventListener('click', () => {
        tiles = [...tiles, newTile(addSelect.value)];
        save();
        render();
    });
    document.querySelector('#tiles .reset-tiles').addEventListener('click', () => {
        tiles = defaults.map(t => ({...t}));
        save();
        render();
    });
    render();
}
