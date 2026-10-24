/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The calls worth hearing or reading on the Zwift screen, picked from the meters (meter-engine.mjs `ds`): your own
 * slow pass (closing 1–5 km/h faster gets you held), being blocked, a rider creeping up on you. Each call type has its
 * own delivery, either or both of: a chime (its own sound per type), the browser's voice (engine/speech.mjs); the
 * windows show it too. A call is a word or two from the data object (ds-data.mjs VOCAB, docs/DS-DATA.md: the tile and
 * the voice say the same), plus seconds when something is ahead (`in`, `for`). v0.30.0: no more Zwift messages to
 * yourself (the user, 2026-10-19: the voice and a window do the same; one less thing that sends into Zwift). Speeds and
 * distances follow Sauce's metric / imperial switch. Advice only. Pure: no Sauce imports.
 *
 * 2026-10-12 group ride (59 min): "being passed" came up 46 times, your own slow pass 36 (research/2026-10-12/
 * ds-replay.mjs). Waiting longer before calling only trims that to ~25–30 an hour: they are real, it is a busy group
 * ride. So the rider picks how each type arrives (the user: "A chime may be all that you need when being passed"),
 * and one type sounds at most once per CALL_REPEAT_S.
 */

import {speechText, MIN_GAP_S} from './engine/speech.mjs';
import {wordOf, directorCalls} from './ds-data.mjs';

export const CALL_REPEAT_S = 30;     // one call type sounds (chime or voice) at most this often

/* The call types and their chimes: rising = your move, falling = you are stuck, one low tone = someone behind. */
export const CALL_TYPES = [
    {id: 'pass', label: 'Your pass', hint: 'you close on a rider too slowly to get by', tones: [880, 1320]},
    {id: 'passed', label: 'Being passed', hint: 'a rider creeps up on you', tones: [660]},
    {id: 'gap', label: 'Gap opening', hint: 'a hole opening in front of your wheel or the next: close it or go round before you are gapped',
     tones: [740, 1100]},
    {id: 'blocked', label: 'Blocked', hint: 'pushing into the wheel, or stuck alongside', tones: [1320, 880]},
    {id: 'tuck', label: 'Supertuck', hint: 'fast enough on a descent to tuck: stop pedaling', tones: [990, 990]},
    {id: 'moveUp', label: 'Move up', hint: 'before a climb: move up along the edge 60–45 s out, then hold the spot',
     tones: [660, 880, 1100]},
    {id: 'sprint', label: 'Finish', hint: 'the last 1.5 km: your spot, the wind-up, last wheel, when you can go, keep going, ease to FTP / ease off once your place is safe (intermediate sprints too, from the race card), shake a wheel',
     tones: [1100, 1320, 1100]},
    {id: 'wheel', label: 'Take the wheel', hint: 'the last km, before you can go to the line: a rider coming past 4–8 km/h faster is a wheel to take; "wheel, jump light / medium / hard" at the moment to go (2–3 s before they are level)',
     tones: [1100, 880]},
    {id: 'powerup', label: 'Power-up', hint: 'at the finish: when to fire the power-up you hold (advice only)',
     tones: [880, 1320, 1760]},
    {id: 'card', label: 'Race card', hint: 'the race card for this route: scored sprints and KOMs ahead and their line, ' +
     'arches that give a power-up, your notes', tones: [740, 990, 740]},
    {id: 'surface', label: 'Surfaces', hint: 'a rough surface ahead on this road (wood, dirt, cobbles…): when and how long',
     tones: [440, 440]},
    {id: 'pacing', label: 'Climb pacing', hint: 'a steep part ahead (when and how long), the top of the climb close',
     tones: [600, 800]},
    {id: 'bend', label: 'Bends', hint: 'a bend ahead: "inside left / right" when the inside is open and moving over ' +
     'gains ground (after the draft it costs), "stay close" when you are on the outside and will lose ground',
     tones: [700, 940]},
    {id: 'nudge', label: 'Habits', hint: 'a habit worth changing, after it lasts: pushing into the wheel, moving up the ' +
     'middle, sitting on the front, off the wheel in a small group (each at most every 5 min)', tones: [520, 660]},
];
export const DELIVERY = ['chime', 'voice'];

/* The settings key for one type × way, e.g. callPassedChime. */
export function deliveryKey(type, how) {
    return `call${type[0].toUpperCase()}${type.slice(1)}${how[0].toUpperCase()}${how.slice(1)}`;
}

/*
 * Defaults for every delivery key. old = the settings before per-type delivery (speakCalls, speechChime): whoever
 * had the voice on keeps it, except being passed, which gets the chime alone.
 */
export function deliveryDefaults(old = {}) {
    const voice = old.speakCalls === true;
    const chime = voice && old.speechChime !== false;
    const out = {};
    for (const t of CALL_TYPES) {
        // tuck added v0.11.3: a chime only (a message arrives too late on a descent); take the wheel v0.26.0: a chime only
        if (t.id === 'tuck' || t.id === 'wheel') {
            out[deliveryKey(t.id, 'chime')] = true;
            out[deliveryKey(t.id, 'voice')] = false;
            continue;
        }
        if (['nudge', 'surface', 'pacing', 'bend'].includes(t.id)) {   // v0.17–0.19, bend v0.40.0: the voice for voice users, else off
            out[deliveryKey(t.id, 'chime')] = false;
            out[deliveryKey(t.id, 'voice')] = voice;
            continue;
        }
        if (['moveUp', 'sprint', 'powerup', 'card', 'gap'].includes(t.id)) {   // added v0.14–0.18, gap v0.26.0: chime on; voice for voice users
            out[deliveryKey(t.id, 'chime')] = true;
            out[deliveryKey(t.id, 'voice')] = voice;
            continue;
        }
        out[deliveryKey(t.id, 'chime')] = t.id === 'passed' ? voice : chime;
        out[deliveryKey(t.id, 'voice')] = t.id === 'passed' ? false : voice;
    }
    return out;
}

/*
 * The settings window's delivery grid: one row per call type, a checkbox per way, bound by name like any setting.
 * Each checkbox sits in a <label>: Sauce's settings form marks the label it was edited in before it saves
 * (common.mjs bindFormData el.closest('label')), so a bare checkbox throws and is never saved (v0.11.1 fix).
 * esc, escAttr: HTML escaping (Sauce's sanitize, sanitizeAttr).
 */
export function deliveryGridHTML(esc = x => x, escAttr = x => x) {
    const head = ['', 'Chime', 'Voice'].map(h => `<div class="head">${h}</div>`).join('');
    return head + CALL_TYPES.map(t => `<div class="type" title="${escAttr(t.hint)}">${esc(t.label)}</div>` +
        DELIVERY.map(how => `<label class="how" title="${how}">` +
            `<input type="checkbox" name="${deliveryKey(t.id, how)}"/></label>`).join('')).join('');
}

/* {text, chime, voice} for a call type from the settings. */
export function deliveryFor(settings, type) {
    return Object.fromEntries(DELIVERY.map(how => [how, settings?.[deliveryKey(type, how)] === true]));
}

export const KMH_PER_MPH = 1.609344;
export const FT_PER_M = 3.28084;

/*
 * Speeds and distances in a line, in imperial when asked: "+2.5 km/h" -> "+1.6 mph", "5+ km/h" -> "3+ mph",
 * "3–5 m" -> "10–16 ft", "1.5 m+" -> "5 ft+". Metric lines come back unchanged.
 */
export function localizeUnits(text, imperial) {
    const s = String(text ?? '');
    if (!imperial) return s;
    const fmt = (x, decimals) => (decimals ? x.toFixed(1) : String(Math.round(x)));
    return s.replace(/(\d+(?:\.\d+)?)(?:([–-])(\d+(?:\.\d+)?))?(\+?) (km\/h|m)(?![\w/²])/g, (all, a, dash, b, plus, unit) => {
        const k = unit === 'km/h' ? 1 / KMH_PER_MPH : FT_PER_M;
        const dec = unit === 'km/h' && /\./.test(a);
        const x = fmt(Number(a) * k, dec);
        const y = b != null ? `${dash}${fmt(Number(b) * k, dec)}` : '';
        return `${x}${y}${plus} ${unit === 'km/h' ? 'mph' : 'ft'}`;
    });
}

/* Call priorities (docs/DS-DATA.md; the director's move-up 80 / sprint 55–93 sit around them). */
export const CALL_PRIORITY = {gap: 75, pass: 70, blocked: 65, passed: 60, tuck: 40};

const call = (id, state, word, extra = {}) => ({id, state, word, in: null, for: null, priority: CALL_PRIORITY[id], ...extra});

/*
 * The call to deliver now or null: {id (a CALL_TYPES id), state, word, in, for (seconds, or null), priority}. The
 * candidates: the pack calls from the data object's meters (your own pass, blocked, being passed, the tuck; their
 * words are the meters' own, VOCAB) and the director's (`extra`: ds-data.mjs directorCalls, e.g. move up before a
 * climb). The highest priority wins; on a tie the earlier one.
 */
export function dsCall(data, extra = []) {
    const m = data && data.meters;
    if (!m) return null;
    const c = [];
    const pass = m.passing && m.passing.state;
    // "go wide" is shown (the Passing meter), never called: it fired ~once a minute on pack yo-yo, and a slow pass
    // out of the draft costs 5–7× the held seconds it saves (user, 2026-10-23: trained to ignore it)
    if (['too-slow', 'drop-back'].includes(pass)) c.push(call('pass', pass, wordOf('passing', pass)));
    const blk = m.blocked && m.blocked.state;
    if (blk === 'blocked') c.push(call('blocked', 'wheel', wordOf('blocked', blk)));
    if (blk === 'blocked-left' || blk === 'blocked-right') c.push(call('blocked', blk.slice(8), wordOf('blocked', blk)));
    if (pass === 'rider-left' || pass === 'rider-right' || pass === 'rider-behind') {
        c.push(call('passed', pass.slice(6), wordOf('passing', pass)));
    }
    if (m.position && m.position.state === 'gapping') c.push(call('gap', 'opening', wordOf('position', 'gapping')));
    if (m.tuck && m.tuck.state === 'stop') c.push(call('tuck', 'stop', wordOf('tuck', 'stop')));
    for (const x of extra || []) if (x && x.word) c.push(x);
    let best = null;
    for (const x of c) if (!best || (x.priority ?? 0) > (best.priority ?? 0)) best = x;
    return best;
}

/* The call from the engine's reading: the data object's pack calls and the director's. */
export const engineCall = (data, ds) => dsCall(data, directorCalls(ds));

/* What the voice says and the windows show: the word, then the time if something is ahead ("steep in 25"). */
export function callWords(c) {
    if (!c) return '';
    const t = Number.isFinite(c.in) ? ` in ${Math.round(c.in)}` : '';
    const f = Number.isFinite(c.for) ? ` for ${Math.round(c.for)}` : '';
    return `${c.word}${t}${f}`;
}

/*
 * Decides what a call sounds like now: offer(call, delivery, nowMs) -> {tones (chime, or null), say (words for the
 * voice, or null)} or null. Only a new call (id|state changed) sounds, at least MIN_GAP_S after the last sound and
 * CALL_REPEAT_S after the last one of its type; a call held back sounds when the wait is over if it is still on.
 */
export class Announcer {
    constructor({minGapS = MIN_GAP_S, repeatS = CALL_REPEAT_S} = {}) {
        this.minGapMs = minGapS * 1000;
        this.repeatMs = repeatS * 1000;
        this.lastKey = null;
        this.lastAt = -Infinity;
        this.typeAt = new Map();
    }

    offer(call, delivery, now = Date.now()) {
        if (!call) {
            this.lastKey = null;
            return null;
        }
        if (!delivery || (!delivery.chime && !delivery.voice)) return null;
        const key = `${call.id}|${call.state}`;
        if (key === this.lastKey) return null;
        if (now - this.lastAt < this.minGapMs || now - (this.typeAt.get(call.id) ?? -Infinity) < this.repeatMs) return null;
        this.lastKey = key;
        this.lastAt = now;
        this.typeAt.set(call.id, now);
        const type = CALL_TYPES.find(t => t.id === call.id);
        return {tones: delivery.chime && type ? type.tones : null, say: delivery.voice ? speechText(callWords(call) || call.say || call.text) : null};
    }
}
