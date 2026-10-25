/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the Grid can show (docs/DS-DISPLAY.md step 3), all read from the data object (ds-data.mjs) and nothing else:
 * - the meters: meter-fields.mjs, the same formatting as the meter window (one source);
 * - a word field per meter: the word big, in a slot of its own ("Position word" -> "back off");
 * - All words: the call and every meter's word at once, one line like the old messages to yourself;
 * - the basics the object passes through (power, speed, draft, cadence, your heart rate, grade), so a grid can mix
 *   them in without asking Sauce.
 * slotView() turns a slot + the latest object into what the slot shows, with its color: the slot's own thresholds
 * if set, else the meter's own level from the object. Pure (no Sauce imports): tested headless.
 */

import {meterFields, KMH_PER_MPH} from './meter-fields.mjs';
import {VOCAB, wordOf} from './ds-data.mjs';
import {rangeLevel, shownNumber} from './tiles.mjs';
import {callWords} from './calls.mjs';

/* Field id -> the meter in the data object it reads (for the meter's own level). */
export const METER_OF = {
    'ds-position': 'position', 'ds-holding': 'holding', 'ds-pack': 'pack', 'ds-blocked': 'blocked',
    'ds-pass': 'passing', 'ds-gap': 'gap', 'ds-side': 'side', 'ds-tuck': 'tuck', 'ds-group': 'group', 'ds-cda': 'cda',
    'ds-surface': 'surface', 'ds-frc': 'frc', 'ds-demand': 'demand'
};

const NAMES = {
    position: 'Position', holding: 'Holding', pack: 'Pack cost', blocked: 'Blocked', passing: 'Passing', gap: 'Gap',
    side: 'L/R', tuck: 'Tuck', surface: 'Surface', frc: 'FRC', demand: 'Demand',
};

/* The words fields: one per meter that has words to say. */
function wordFields() {
    return Object.keys(NAMES).filter(k => Object.values(VOCAB[k]).some(w => w.word)).map(k => ({
        id: `ds-word-${k}`,
        shortName: NAMES[k],
        longName: `${NAMES[k]} word`,
        tooltip: `What ${NAMES[k]} says to do, big (the same word as under its number, and the voice).`,
        format: x => {
            const e = x && x.dsData && x.dsData.meters ? x.dsData.meters[k] : null;
            return e ? wordOf(k, e.state) || null : null;
        },
        suffix: '',
        meter: k,
        isWord: true,
    }));
}

/*
 * All words is advice only: the meter states that tell you to do something, in this order (legs and line first).
 * Descriptions stay out (Pack's "boxed" / "crowded", Gap's and L/R's "beside", surfaces, "stay", "hold", "drifting"):
 * replayed over the 2026-10-22 group ride they were most of the words and changed the text every ~4 s.
 */
export const ADVICE = {
    blocked: ['blocked', 'blocked-left', 'blocked-right'],
    passing: ['too-slow', 'go-wide', 'drop-back', 'rider-left', 'rider-right', 'rider-behind'],
    position: ['shatter', 'gapping', 'too-close', 'boxed', 'close-up', 'find-wheel', 'unsteady', 'no-draft', 'sit-in'],
    holding: ['easy', 'blocked'],
    tuck: ['build', 'stop', 'rest'],
    frc: ['low', 'empty'],
};
export const WORDS_HOLD_S = 3;   // a word stays up at least this long after its meter stops saying it

/*
 * The advice showing now: the call (with its seconds, as the voice says it) and each meter's advice word, a word
 * said twice only once ("ease off" from Blocked and Holding). {text, level}: level = the worst of the meters speaking.
 * hold (optional Map, kept between ticks): a word stays WORDS_HOLD_S after it goes, so the tile doesn't flicker; a new
 * word from the same meter replaces it at once.
 */
export function allWords(data, hold = null) {
    if (!data) return {text: null, level: ''};
    const now = Number.isFinite(data.ts) ? data.ts : 0;
    const said = [];
    if (data.call) said.push({src: 'call', word: callWords(data.call), level: ''});
    for (const [k, states] of Object.entries(ADVICE)) {
        const e = data.meters?.[k];
        if (e && states.includes(e.state) && wordOf(k, e.state)) said.push({src: k, word: wordOf(k, e.state), level: e.level || ''});
    }
    let shown = said;
    if (hold) {
        for (const x of said) hold.set(x.src, {...x, until: now + WORDS_HOLD_S * 1000});
        for (const [src, x] of hold) if (x.until < now) hold.delete(src);
        const order = ['call', ...Object.keys(ADVICE)];
        shown = order.filter(src => hold.has(src)).map(src => hold.get(src));
    }
    const words = [];
    let level = '';
    for (const x of shown) {
        if (!words.includes(x.word)) words.push(x.word);
        if (x.level === 'alarm' || (x.level === 'warn' && !level)) level = x.level;
    }
    return {text: words.length ? words.join(' · ') : null, level};
}

function allWordsField() {
    const hold = new Map();
    let last = null, view = {text: null, level: ''};
    const get = data => {
        if (data !== last) { last = data; view = allWords(data, hold); }
        return view;
    };
    return {
        id: 'ds-words',
        shortName: 'Words',
        longName: 'All words',
        tooltip: 'Everything the director and the meters tell you to do now, in one line: the call first, then each meter\'s advice.',
        format: x => get(x && x.dsData).text,
        suffix: '',
        isWord: true,
        wrap: true,
        level: x => get(x && x.dsData).level,
    };
}

/* The basics the object passes through. */
function basicFields({imperial}) {
    const b = (key, x) => {
        const v = x && x.dsData && x.dsData.basics ? x.dsData.basics[key] : null;
        return Number.isFinite(v) ? v : null;
    };
    const fmt = (v, d = 0) => (v == null ? null : v.toFixed(d));
    return [
        {id: 'ds-power', shortName: 'Power', longName: 'Power', format: x => fmt(b('power', x)), suffix: 'W'},
        {id: 'ds-speed', shortName: 'Speed', longName: 'Speed',
         format: x => { const v = b('speed', x); return fmt(v == null ? null : imperial ? v / KMH_PER_MPH : v, 1); },
         suffix: imperial ? 'mph' : 'km/h'},
        {id: 'ds-draft', shortName: 'Draft', longName: "Draft (Zwift's)", format: x => fmt(b('draft', x)), suffix: 'W'},
        {id: 'ds-cadence', shortName: 'Cadence', longName: 'Cadence', format: x => fmt(b('cadence', x)), suffix: 'rpm'},
        {id: 'ds-hr', shortName: 'HR', longName: 'Heart rate (yours)', format: x => fmt(b('heartrate', x)), suffix: 'bpm'},
        {id: 'ds-grade', shortName: 'Grade', longName: 'Grade',
         format: x => { const v = b('grade', x); return fmt(v == null ? null : v * 100, 1); }, suffix: '%'},
    ];
}

/* Every field the Grid offers, grouped for the settings window's picker (tiles.mjs fieldCatalog input). */
export function gridGroups(opts = {}) {
    const meters = meterFields(opts).map(f => ({...f, meter: METER_OF[f.id] || null}));
    return [
        {title: 'Director Sportif', fields: meters},
        {title: 'Words', fields: [allWordsField(), ...wordFields()]},
        {title: 'Basics', fields: basicFields(opts)},
    ];
}

/* The Grid's starting slots (a new install; the rider changes them in the settings window). */
/*
 * A fresh Grid (v0.44.0, the user): the five that matter, numbers only. The words are in one place, the Director
 * Sportif window's All words line ("spread over a lot of meters they aren't where you are looking"); a slot shows its
 * meter's word only when you switch it on (note).
 */
export const GRID_DEFAULT_TILES = [
    {id: 'grid-position', field: 'ds-position', size: 'large', note: false},
    {id: 'grid-holding', field: 'ds-holding', size: 'large', note: false},
    {id: 'grid-blocked', field: 'ds-blocked', size: 'normal', note: false},
    {id: 'grid-gap', field: 'ds-gap', size: 'normal', note: false},
    {id: 'grid-side', field: 'ds-side', size: 'normal', note: false},
].map(t => ({...t, warn: null, alarm: null}));   // null: the meter's own level from the data object

const fget = (v, x) => (typeof v === 'function' ? v(x) : v);

/*
 * What one slot shows now: {key, value, unit, word, level ('' | 'warn' | 'alarm')}. field: one of gridGroups'
 * fields; slot: {note (show the word), warn, alarm}; data: the latest object, or null (no data: all blank).
 */
export function slotView(field, slot, data) {
    const x = {dsData: data};
    let value = null, word = '', unit = '';
    if (data) {
        try { value = fget(field.format, x); } catch (e) { value = null; }
        try { word = slot.note && field.label ? fget(field.label, x) || '' : ''; } catch (e) { word = ''; }
        try { unit = value == null || value === '' ? '' : fget(field.suffix, x) || ''; } catch (e) { unit = ''; }
    }
    let level = '';
    const own = slot.warn != null || slot.alarm != null;
    if (value != null && own) {
        level = rangeLevel(shownNumber(value), slot.warn, slot.alarm);
    } else if (value != null && field.meter && !field.isWord) {
        level = data.meters?.[field.meter]?.level || '';
    } else if (value != null && field.level) {
        try { level = fget(field.level, x) || ''; } catch (e) { level = ''; }
    }
    return {key: fget(field.shortName, x) || '', value: value == null ? '' : String(value), unit, word, level};
}
