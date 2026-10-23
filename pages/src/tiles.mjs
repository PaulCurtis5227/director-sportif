/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The meter window's layout: a list of tiles, one meter each, that the rider adds, removes and orders in the settings
 * window. Pure (no DOM, no Sauce), so the list handling is tested headless.
 *
 *   tile = {id, field, size: 'large' | 'normal' | 'small', note: show the meter's one-line explanation,
 *           warn, alarm: the reading turns yellow / red past these (null = off; warn above alarm = low is bad)}
 */

export const SIZES = [
    {id: 'large', label: 'Large'},
    {id: 'normal', label: 'Normal'},
    {id: 'small', label: 'Small'},
];

/*
 * Starting color ranges for the meters ([yellow at, red at], W): Holding ±20 W is holding (holding.mjs HOLD_BAND_W);
 * Blocked cues at 10 W (blocking.mjs BLOCK_CUE_W); Pack cost from its typical spread (docs/FINDINGS.md); Position (watts
 * short of the ideal spot, v0.31.0) from the field in two races: green under its P25 (7 W), red over its P75 (28 W).
 */
export const DEFAULT_RANGES = {
    'ds-holding': [20, 40],
    'ds-position': [7, 28],
    'ds-blocked': [10, 30],
    'ds-pack': [25, 40],
};
const rangeOf = field => DEFAULT_RANGES[field] || [null, null];

export const DEFAULT_TILES = [
    {id: 'ds-tile-position', field: 'ds-position', size: 'large', note: true},
    {id: 'ds-tile-holding', field: 'ds-holding', size: 'large', note: true},
    {id: 'ds-tile-blocked', field: 'ds-blocked', size: 'normal', note: true},
    {id: 'ds-tile-pass', field: 'ds-pass', size: 'normal', note: true},
    {id: 'ds-tile-pack', field: 'ds-pack', size: 'normal', note: true},
    {id: 'ds-tile-gap', field: 'ds-gap', size: 'normal', note: false},
    {id: 'ds-tile-side', field: 'ds-side', size: 'normal', note: false},
    {id: 'ds-tile-tuck', field: 'ds-tuck', size: 'normal', note: true},
].map(t => ({...t, warn: rangeOf(t.field)[0], alarm: rangeOf(t.field)[1]}));

let seq = 0;
export function newTile(field, size = 'normal') {
    const [warn, alarm] = rangeOf(field);
    return {id: `ds-tile-${Date.now().toString(36)}-${(seq++).toString(36)}`, field, size, note: true, warn, alarm};
}

const numOrNull = x => (x === '' || x == null || !Number.isFinite(Number(x)) ? null : Number(x));

/* 'alarm' | 'warn' | '' for a reading. warn ≤ alarm: high is bad; warn > alarm: low is bad; either may be null. */
export function rangeLevel(value, warn, alarm) {
    const v = Number(value), w = numOrNull(warn), a = numOrNull(alarm);
    if (!Number.isFinite(v) || (w == null && a == null)) return '';
    const lowBad = w != null && a != null && w > a;
    const past = (x, lim) => (lowBad ? x <= lim : x >= lim);
    if (a != null && past(v, a)) return 'alarm';
    if (w != null && past(v, w)) return 'warn';
    return '';
}

/* The number in a tile's shown value ("+12", "−5", "L 1.2", "↑2.5", "1.2k"…), or NaN. */
export function shownNumber(text) {
    const m = String(text ?? '').replace(/−/g, '-').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
}

/* A copy of the list with tile `id` moved by dir (−1 up, +1 down); unchanged at the ends or for an unknown id. */
export function moveTile(tiles, id, dir) {
    const out = [...tiles];
    const i = out.findIndex(t => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}

export const MAX_COLUMNS = 8;

/*
 * The window's layout: how many columns and which tiles show. columns 1..MAX_COLUMNS (saved settings from before
 * v0.10.0 have only horizMode: all tiles in one row); maxTiles 0 or empty = all, else the first maxTiles of the list.
 */
export function layout(tiles, {columns, maxTiles, horizMode} = {}) {
    const n = Math.floor(Number(maxTiles));
    const shown = n > 0 ? tiles.slice(0, n) : tiles;
    let c = Math.floor(Number(columns));
    if (!(c >= 1)) c = horizMode ? shown.length : 1;
    return {shown, columns: Math.max(1, Math.min(MAX_COLUMNS, c, shown.length || 1))};
}

/* Saved tiles cleaned up: unknown sizes become normal, tiles for fields that no longer exist are dropped. */
export function cleanTiles(tiles, fieldIds, defaults = DEFAULT_TILES) {
    if (!Array.isArray(tiles)) return defaults.map(t => ({...t}));
    return tiles
        .filter(t => t && typeof t.id === 'string' && fieldIds.has(t.field))
        .map(t => ({id: t.id, field: t.field, size: SIZES.some(s => s.id === t.size) ? t.size : 'normal',
                    note: t.note !== false,
                    // tiles saved before ranges existed get the meter's starting range; a cleared one stays off
                    warn: 'warn' in t ? numOrNull(t.warn) : rangeOf(t.field)[0],
                    alarm: 'alarm' in t ? numOrNull(t.alarm) : rangeOf(t.field)[1]}));
}

const nameOf = f => {
    for (const k of ['longName', 'shortName']) {
        try {
            const v = typeof f[k] === 'function' ? f[k]() : f[k];
            if (v) return String(v).replace(/<[^>]*>/g, '');
        } catch (e) { /* a Sauce field whose name needs data: try the next */ }
    }
    return f.id;
};

/*
 * Every field a tile can show, grouped for a <select>: [{title, fields: [{id, name, field}]}]. groups: [{title,
 * fields}] in display order; a field id that appears in more than one group is offered once (the first).
 */
export function fieldCatalog(groups) {
    const seen = new Set();
    return groups.map(g => ({
        title: g.title,
        fields: g.fields.filter(f => f && f.id && !seen.has(f.id) && seen.add(f.id))
            .map(f => ({id: f.id, name: nameOf(f), field: f})),
    })).filter(g => g.fields.length);
}
