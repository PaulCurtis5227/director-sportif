/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Grid (docs/DS-DISPLAY.md step 3): a display and nothing else. It reads the data object the Director Sportif
 * window publishes on BroadcastChannel(CHANNEL) (ds-data.mjs, docs/DS-DATA.md) and shows the slots the rider set:
 * name, number, unit, word, colored by the slot's thresholds or the meter's own level. It computes no meter and asks
 * Sauce for no data: from Sauce only the basics every mod uses (title bar, settings store, the common look).
 * Without the Director Sportif window there is no data: it says so.
 */

import * as Common from '/pages/src/common.mjs';
import {CHANNEL, DATA_VERSION} from './ds-data.mjs';
import {gridGroups, slotView, GRID_DEFAULT_TILES} from './grid-fields.mjs';
import {MAX_COLUMNS, cleanTiles, fieldCatalog, layout} from './tiles.mjs';
import {setStyles, windowFitter, tileEl, initTileEditor} from './window-ui.mjs';

const doc = document.documentElement;
export const STALE_MS = 5000;        // no tick for this long: the Director Sportif window is gone
const WAITING = 'waiting for the Director Sportif window';

export const GRID_DEFAULTS = {
    themeOverride: 'transparent-dark',   // see-through like Sauce's grid; mouse over shows the window
    solidBackground: false,
    backgroundColor: '#00ff00',
    columns: 1,
    maxTiles: 0,
    fitWindow: true,
    textScale: 100,
    sideUnit: 'ft',
    tiles: GRID_DEFAULT_TILES,
};

/* Missing settings one key at a time (never settingsStore.setDefault: it only fills an empty store). */
function applyDefaults() {
    for (const [k, v] of Object.entries(GRID_DEFAULTS)) {
        Common.settingsStore.get(k, v);
    }
    const s = Common.settingsStore.get();
    if (s.themeOverride) doc.dataset.theme = s.themeOverride;   // Sauce read the theme before the default was written
}

const groupsFor = (settings, current) => gridGroups({sideUnit: settings.sideUnit,
                                                     imperial: !!Common.settingsStore.get('/imperialUnits'), current});

export async function main() {
    Common.initInteractionListeners();
    applyDefaults();
    const settings = Common.settingsStore.get();
    let latest = null;
    const groups = groupsFor(settings, () => latest);
    const all = groups.flatMap(g => g.fields);
    const byId = new Map(all.map(f => [f.id, f]));
    const {shown: tiles, columns} = layout(cleanTiles(settings.tiles, new Set(byId.keys()), GRID_DEFAULT_TILES),
                                           {...settings, columns: Math.min(MAX_COLUMNS, settings.columns || 1)});
    setStyles(settings, columns);
    const content = document.querySelector('#content');
    const status = document.querySelector('#status');
    const slots = tiles.map(tile => {
        const el = tileEl(tile, tile.id);
        content.append(el);
        const field = byId.get(tile.field);
        if (field && field.wrap) el.classList.add('wrap');   // All words: several words, wraps instead of widening
        el.addEventListener('mouseenter', () => {
            try {
                el.title = (typeof field.tooltip === 'function' ? field.tooltip() : field.tooltip) || field.longName || '';
            } catch (e) { el.title = field.longName || ''; }
        });
        return {tile, field, el, key: el.querySelector('.key'), value: el.querySelector('.value'),
                unit: el.querySelector('.unit'), word: el.querySelector('.label'), last: {}};
    });
    if (!slots.length) {
        content.innerHTML = '<div class="empty">No meters: add some with the gear in the title bar ' +
            '(right-click the window to show it).</div>';
    }
    const set = (el, prop, v, s, k) => {
        if (s.last[k] !== v) {
            s.last[k] = v;
            el[prop] = v;
        }
    };
    const render = data => {
        for (const s of slots) {
            const v = slotView(s.field, s.tile, data);
            set(s.key, 'textContent', v.key, s, 'key');
            set(s.value, 'textContent', v.value, s, 'value');
            set(s.unit, 'textContent', v.unit, s, 'unit');
            set(s.word, 'textContent', v.word, s, 'word');
            if (s.last.level !== v.level) {
                s.last.level = v.level;
                s.el.classList.toggle('warn', v.level === 'warn');
                s.el.classList.toggle('alarm', v.level === 'alarm');
            }
        }
    };
    const fitter = windowFitter(content, {extras: () => [status]});
    const fitWindow = () => {
        if (Common.settingsStore.get('fitWindow') !== false) fitter.fit();
    };
    render(null);
    status.textContent = WAITING;
    status.hidden = false;
    requestAnimationFrame(fitWindow);

    let lastTick = 0;
    let channel = null;
    try {
        channel = new BroadcastChannel(CHANNEL);
    } catch (e) {
        status.textContent = 'this Sauce can\'t pass data between windows';
        return;
    }
    channel.addEventListener('message', ev => {
        const m = ev.data;
        if (!m || m.type !== 'tick' || !m.data || m.data.v !== DATA_VERSION) return;
        latest = m.data;
        lastTick = Date.now();
        if (!status.hidden) {
            status.hidden = true;
            requestAnimationFrame(fitWindow);
        }
        render(latest);
    });
    channel.postMessage({type: 'hello'});
    // no tick for a while: the Director Sportif window is closed (or its rider gone): blank, and say so
    setInterval(() => {
        if (status.hidden && Date.now() - lastTick > STALE_MS) {
            latest = null;
            render(null);
            status.textContent = WAITING;
            status.hidden = false;
        }
    }, 1000);

    Common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) return;
        const key = ev.data.key;
        if (['backgroundColor', 'solidBackground', 'backgroundAlpha', 'textScale'].includes(key)) {
            setStyles(Common.settingsStore.get(), columns);
            requestAnimationFrame(fitWindow);
        } else if (key === 'fitWindow') {
            setStyles(Common.settingsStore.get(), columns);
            requestAnimationFrame(fitWindow);
        } else if (!['/theme', 'themeOverride'].includes(key)) {
            window.location.reload();   // the slots, columns or units changed
        }
    });
}

/* ----- the Grid's settings window ----- */

export async function settingsMain() {
    Common.initInteractionListeners();
    applyDefaults();
    await Common.initSettingsForm('form#look')();
    initTileEditor(fieldCatalog(groupsFor(Common.settingsStore.get(), () => null)),
                   {defaults: GRID_DEFAULT_TILES, addDefault: 'ds-word-position'});
}
