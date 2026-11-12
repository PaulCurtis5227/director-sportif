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

export const CALL_REPEAT_S = 30;     // the same call (type and words) sounds (chime or voice) at most this often
// v0.60.0: another message of the same type waits only this long (the user, 2026-11-07: "block right" 5 s after "block
// left" and "losing group" 14 s after "gap opening" stayed on screen, unspoken, under the old once-per-type 30 s)
export const TYPE_NEW_S = 10;

/* The call types and their chimes: rising = your move, falling = you are stuck, one low tone = someone behind. */
export const CALL_TYPES = [
    {id: 'pass', label: 'Your pass', hint: 'you close on a rider too slowly to get by ("go harder"), or glued to their wheel ("drop back": not while you move up through the group)', tones: [880, 1320]},
    {id: 'passed', label: 'Being passed', hint: 'a rider creeps up on you', tones: [660]},
    {id: 'gap', label: 'Gap opening', hint: 'a hole opening in front of your wheel or the next, or you losing the group (v0.58.0): close it or go round before you are gapped',
     tones: [740, 1100]},
    {id: 'shatter', label: 'Group shattering', hint: 'the riders ahead splitting or leaving: hold the front part, or the group you can (v0.57.0: its own row, was part of Gap opening)',
     tones: [740, 1100, 740]},
    {id: 'blocked', label: 'Ease off (blocked)', hint: 'pushing into the wheel ahead: the watts vanish; the Wheel gap tile turns red too. Never while you move up through the group', tones: [1320, 880]},
    {id: 'step', label: 'Step out', hint: 'held on the wheel ahead: half a meter left or right, out of its line (v0.57.0: its own row, was part of Blocked)',
     tones: [1320, 1100]},
    {id: 'alongside', label: 'Stuck alongside', hint: 'stuck beside a rider: drop back, pass where there is room. Never while you move up through the group (v0.57.0: its own row, was part of Blocked)',
     tones: [1100, 880]},
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
    {id: 'pace', label: 'Segment pacing', hint: 'a segment card from caffecter.com: "go in 10", then the plan\'s own words at each effort ("go, 730", "empty it")',
     tones: [880, 1100, 880]},
    {id: 'surface', label: 'Surfaces', hint: 'a rough surface ahead on this road (wood, dirt, cobbles…): when and how long',
     tones: [440, 440]},
    {id: 'bridge', label: 'Bridge', hint: 'after you press Bridge (the Bridge button setting, below): when to go for the riders up the road for the least FRC ("bridge now", "bridge on the climb in 40", "last chance to bridge", "too far to bridge"), then the watts to hold on the way, and "made it"',
     tones: [660, 990, 1320]},
    {id: 'pacing', label: 'Climb pacing', hint: 'a steep part ahead (when and how long), the top of the climb close',
     tones: [600, 800]},
    {id: 'bend', label: 'Bends', hint: 'their own lane (v0.57.0): every bend, not held back by the other calls. A bend ahead: "move left / right" when the inside is open and moving over ' +
     'gains ground (after the draft it costs); nothing when you are on the inside already or stuck outside; alone and in the finish too (v0.58.0); ' +
     '"cut the S" / "cut the bend" before a stretch that twists enough to steer a shorter line (dirt S curves most)',
     tones: [700, 940]},
    {id: 'flyer', label: 'Flyer', hint: 'one or two riders jumping off the front of your bunch, in an event: "flyer, go", said as they ' +
     'go (3 km/h+ faster than the bunch, under 2.5 s up) so the wheel can still be caught; while it goes, no "ease off" (v0.66.0, flyer.mjs)',
     tones: [990, 1320, 990]},
    {id: 'teamHr', label: 'Teammate HR', hint: 'you or a teammate in your race (your team tag) with no heart rate for 20 s: ' +
     'in the pen, so they can pair a strap, and in the race (some races disqualify for it); every 2 min until you ' +
     'press I know on the red banner (a teammate: then quiet for the event; you: again only if it comes back and drops out again, up to 3 times)', tones: [880, 660, 880]},
    {id: 'burrito', label: 'Burritos', hint: 'a burrito fired just ahead of you: no draft in its cone for 20 s, move ' +
     'over; "burritos done" once nearly everyone in your race has fired theirs (the Grid Burritos field counts the ' +
     'ones still ahead of you)', tones: [500, 750, 500]},
    {id: 'nudge', label: 'Habits', hint: 'a habit worth changing, after it lasts: pushing into the wheel, moving up the ' +
     'middle, sitting on the front, off the wheel in a small group, crowding the wheel (each at most every 5 min)', tones: [520, 660]},
];
export const DELIVERY = ['chime', 'voice'];

/* The settings key for one type × way, e.g. callPassedChime. */
export function deliveryKey(type, how) {
    return `call${type[0].toUpperCase()}${type.slice(1)}${how[0].toUpperCase()}${how.slice(1)}`;
}

/*
 * Spoken from the start on a fresh install (v0.43.0, the user: "make the installation experience as painless as
 * possible": a new rider heard nothing until they found the Calls tab). Not bends and habits (frequent, nice to have),
 * not being passed (a chime suits it), not the tuck and take-the-wheel (chime only: words come too late).
 * v0.57.0 (the user, 2026-11-05: "stop telling me to do the wrong thing", 1 call a minute): a fresh install no longer
 * hears "ease off", "drop back" (your pass, stuck alongside), being passed or group shattering: on screen only (the
 * Wheel gap tile turns red when you push into the wheel). Step out is heard. Each one a checkbox away.
 */
export const FRESH_VOICE = ['gap', 'step', 'moveUp', 'bridge', 'pace', 'pacing', 'sprint', 'powerup', 'card', 'surface', 'burrito', 'teamHr',
                            'flyer'];

/*
 * Defaults for every delivery key, filled in only where a key is missing (meters.mjs applyDefaults), so a rider's own
 * choices always stay. old = the settings so far: a fresh install (no call settings at all) gets FRESH_VOICE spoken;
 * before per-type delivery there was one voice switch (speakCalls, speechChime): whoever had the voice on keeps it,
 * except being passed, which gets the chime alone.
 */
export function deliveryDefaults(old = {}) {
    const fresh = old.speakCalls === undefined &&
        !CALL_TYPES.some(t => DELIVERY.some(how => old[deliveryKey(t.id, how)] !== undefined));
    if (fresh) {
        const out = deliveryDefaults({speakCalls: false});
        for (const id of FRESH_VOICE) out[deliveryKey(id, 'voice')] = true;
        return out;
    }
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
        // v0.53.0: only after you press Bridge; v0.55.3: only with a segment card; v0.65.0 flyer (the user asked for it; ~6 an
        // hour of racing): spoken for everyone, existing installs too
        if (t.id === 'bridge' || t.id === 'pace' || t.id === 'flyer') {
            out[deliveryKey(t.id, 'chime')] = true;
            out[deliveryKey(t.id, 'voice')] = true;
            continue;
        }
        if (['nudge', 'surface', 'pacing', 'bend'].includes(t.id)) {   // v0.17–0.19, bend v0.40.0: the voice for voice users, else off
            out[deliveryKey(t.id, 'chime')] = false;
            out[deliveryKey(t.id, 'voice')] = voice;
            continue;
        }
        if (['moveUp', 'sprint', 'powerup', 'card', 'gap', 'burrito', 'teamHr'].includes(t.id)) {   // added v0.14–0.18, gap v0.26.0, burrito v0.47.0, teamHr v0.48.0: chime on; voice for voice users
            out[deliveryKey(t.id, 'chime')] = true;
            out[deliveryKey(t.id, 'voice')] = voice;
            continue;
        }
        out[deliveryKey(t.id, 'chime')] = t.id === 'passed' ? voice : chime;
        out[deliveryKey(t.id, 'voice')] = t.id === 'passed' ? false : voice;
    }
    // v0.57.0's new rows take what you had for the row they came out of (step out and stuck alongside were Blocked,
    // group shattering was Gap opening)
    for (const [id, from] of Object.entries(SPLIT_FROM)) {
        for (const how of DELIVERY) {
            const was = old[deliveryKey(from, how)];
            if (was !== undefined) out[deliveryKey(id, how)] = was;
        }
    }
    return out;
}

/* The rows v0.57.0 split out, and the row each came from. */
export const SPLIT_FROM = {step: 'blocked', alongside: 'blocked', shatter: 'gap'};

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
export const URGENT_TYPES = new Set(['sprint', 'wheel', 'powerup', 'bridge', 'pace']);   // Announcer: no wait per type

export const CALL_PRIORITY = {gap: 75, shatter: 75, pass: 70, blocked: 65, step: 65, alongside: 65, passed: 60, tuck: 40};

/*
 * Moving up through the group (the user, 2026-11-05: "the most important thing is that the software stops telling me
 * to do the wrong thing"): while you ride THROUGH_KMH+ faster than your group (meter-engine throughKmh, 3 s), the calls
 * that hold you back or turn you round are wrong, and none of them is made: ease off, drop back (your pass, stuck
 * alongside), give room, get in line, the habit "ease off", and being passed (a distraction mid-move). Step out, gap
 * opening and the rest stay. research/2026-11-05/intent-calls.mjs: silences 68 of the 107 such calls made during moves
 * on 9 rides, and 25 of the 322 made otherwise.
 */
export const THROUGH_KMH = 1;
export const isHoldCall = c => !!c && (c.id === 'passed' || c.id === 'alongside' || (c.id === 'blocked' && c.state === 'wheel') ||
    (c.id === 'pass' && c.state === 'drop-back') || (c.id === 'nudge' && ['wheel', 'line', 'crowd'].includes(c.state)));

const call = (id, state, word, extra = {}) => ({id, state, word, in: null, for: null, priority: CALL_PRIORITY[id], ...extra});

/*
 * The call to deliver now or null: {id (a CALL_TYPES id), state, word, in, for (seconds, or null), priority}. The
 * candidates: the pack calls from the data object's meters (your own pass, blocked, being passed, the tuck; their
 * words are the meters' own, VOCAB) and the director's (`extra`: ds-data.mjs directorCalls, e.g. move up before a
 * climb). The highest priority wins; on a tie the earlier one.
 */
// In the finale only these speak (v0.45.0; 2026-10-25: from 1.3 km to the line the voice said "drop back", "ease off",
// "wood in 45" and "gap opening" around the two finish calls it found room for)
// (run-in); after your jump only the finish's own; past the line nothing ("group shattering" 84 m after it). A bridge
// you asked for speaks in both (v0.55.1): the bridge's attack can itself read as your jump
// v0.58.0: bends too, in the run-in and the sprint (the user, 2026-11-06: two hairpins in the last 300 m, ~4 m lost on
// the first; "steering could really make a difference there"); they have their own lane, so they don't push a finish
// call out
export const FINALE_CALLS = {'run-in': new Set(['sprint', 'wheel', 'powerup', 'card', 'gap', 'shatter', 'bridge', 'pace', 'bend']),
                             sprint: new Set(['sprint', 'wheel', 'powerup', 'bridge', 'pace', 'bend']), done: new Set()};

/*
 * Options: finale (FINALE_CALLS); through: you are moving up through the group (no hold calls, isHoldCall); lane:
 * 'main' (every call but bends), 'bend' (bends only: their own lane, v0.57.0) or 'all'; audible(id): only calls you
 * can hear compete (v0.57.0: a silent call no longer holds back a lower one you hear).
 */
export function dsCall(data, extra = [], {finale = null, through = false, lane = 'all', audible = null} = {}) {
    const only = finale ? FINALE_CALLS[finale] : null;
    const m = data && data.meters;
    if (!m) return null;
    const c = [];
    const pass = m.passing && m.passing.state;
    // "go wide" is shown (the Passing meter), never called: it fired ~once a minute on pack yo-yo, and a slow pass
    // out of the draft costs 5–7× the held seconds it saves (user, 2026-10-23: trained to ignore it)
    if (['too-slow', 'drop-back'].includes(pass)) c.push(call('pass', pass, wordOf('passing', pass)));
    const blk = m.blocked && m.blocked.state;
    if (blk === 'blocked') c.push(call('blocked', 'wheel', wordOf('blocked', blk)));
    if (blk === 'step-left' || blk === 'step-right') c.push(call('step', blk, wordOf('blocked', blk)));
    if (blk === 'blocked-left' || blk === 'blocked-right') c.push(call('alongside', blk.slice(8), wordOf('blocked', blk)));
    if (pass === 'rider-left' || pass === 'rider-right') {
        c.push(call('passed', pass.slice(6), wordOf('passing', pass)));
    }
    if (m.position && m.position.state === 'gapping') c.push(call('gap', 'opening', wordOf('position', 'gapping')));
    if (m.position && m.position.state === 'dropping') c.push(call('gap', 'dropping', wordOf('position', 'dropping')));   // v0.58.0: the same call type
    // v0.60.0: off the back (10 m+ behind the wheel ahead, held 3 s): a don't-get-dropped call, so it is spoken
    if (m.position && m.position.state === 'off-back') c.push(call('gap', 'close-up', wordOf('position', 'off-back')));
    if (m.position && m.position.state === 'shatter') c.push(call('shatter', 'group', 'group shattering'));   // the user's words
    if (m.tuck && m.tuck.state === 'stop') c.push(call('tuck', 'stop', wordOf('tuck', 'stop')));
    for (const x of extra || []) if (x && x.word) c.push(x);
    let best = null;
    for (const x of c) {
        if (only && !only.has(x.id)) continue;
        if (lane === 'main' && x.id === 'bend') continue;
        if (lane === 'bend' && x.id !== 'bend') continue;
        if (through && isHoldCall(x)) continue;
        if (audible && !audible(x.id)) continue;
        if (!best || (x.priority ?? 0) > (best.priority ?? 0)) best = x;
    }
    return best;
}

/* You are moving up through your group (ds.throughKmh: 3 s, you minus your group's median speed). */
export const movingThrough = ds => !!ds && Number.isFinite(ds.throughKmh) && ds.throughKmh >= THROUGH_KMH;

/*
 * The call to show (and record): the data object's pack calls and the director's; a bend when nothing else.
 * audible(id): only calls you can hear (v0.60.0; the user, 2026-11-07: calls on the line you never hear look like the
 * voice failing): the line shows what the voice picks from.
 */
export function engineCall(data, ds, audible = null) {
    const o = {finale: (ds && ds.finale) || null, through: movingThrough(ds), audible};
    const extra = directorCalls(ds);
    return dsCall(data, extra, {...o, lane: 'main'}) || dsCall(data, extra, {...o, lane: 'bend'});
}

/* The calls to sound, one per lane: {main, bend}, each among the calls you can hear (audible(id)). */
export function engineCalls(data, ds, audible = null) {
    const o = {finale: (ds && ds.finale) || null, through: movingThrough(ds), audible};
    const extra = directorCalls(ds);
    return {main: dsCall(data, extra, {...o, lane: 'main'}), bend: dsCall(data, extra, {...o, lane: 'bend'})};
}

/* What the voice says and the windows show: the word, then the time if something is ahead ("steep in 25"). */
export function callWords(c) {
    if (!c) return '';
    const t = Number.isFinite(c.in) ? ` in ${Math.round(c.in)}` : '';
    const f = Number.isFinite(c.for) ? ` for ${Math.round(c.for)}` : '';
    return `${c.word}${t}${f}`;
}

/*
 * Decides what a call sounds like now: offer(call, delivery, nowMs) -> {tones (chime, or null), say (words for the
 * voice, or null)} or null. Only a new call (id|state changed) sounds, at least MIN_GAP_S after the last sound,
 * CALL_REPEAT_S after the same call and TYPE_NEW_S after another of its type (v0.60.0); a call held back sounds when the wait is over if it is still on.
 * Lanes (v0.57.0): the bends have their own Announcer (BEND_LANE: its own timing, each bend by itself); guard = an
 * object both lanes share ({lastAt}) so neither talks over the other (CROSS_GAP_S), while each keeps its own gaps.
 */
export const CROSS_GAP_S = 2.5;   // a short call said: the other lane waits this long
export const BEND_LANE = {minGapS: 3, repeatS: 10, perKey: true};
export class Announcer {
    constructor({minGapS = MIN_GAP_S, repeatS = CALL_REPEAT_S, typeNewS = TYPE_NEW_S, perKey = false, guard = null, crossGapS = CROSS_GAP_S} = {}) {
        this.minGapMs = minGapS * 1000;
        this.typeNewMs = typeNewS * 1000;
        this.repeatMs = repeatS * 1000;
        this.perKey = perKey;
        this.guard = guard;
        this.crossGapMs = crossGapS * 1000;
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
        // the finish's calls follow each other ("top ten", "jump in 20", "you can go", "dig in"): only the same one
        // waits repeatS (2026-10-25: "jump in" would have held "you can go" back 30 s); every other type waits as a type
        // v0.60.0: the same words wait repeatS; another message of the type TYPE_NEW_S (the urgent and per-key lanes: only the same)
        const byKey = this.perKey || URGENT_TYPES.has(call.id);
        const sameWords = this.typeAt.get(key) ?? -Infinity, sameType = byKey ? -Infinity : this.typeAt.get(call.id) ?? -Infinity;
        if (now - this.lastAt < this.minGapMs || now - sameWords < this.repeatMs || now - sameType < this.typeNewMs) return null;
        if (this.guard && now - (this.guard.lastAt ?? -Infinity) < this.crossGapMs) return null;
        this.lastKey = key;
        this.lastAt = now;
        if (this.guard) this.guard.lastAt = now;
        this.typeAt.set(key, now);
        if (!byKey) this.typeAt.set(call.id, now);
        const type = CALL_TYPES.find(t => t.id === call.id);
        return {tones: delivery.chime && type ? type.tones : null, say: delivery.voice ? speechText(callWords(call) || call.say || call.text) : null};
    }
}
