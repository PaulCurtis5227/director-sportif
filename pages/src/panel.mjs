/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The control window is one line: the text, the Record button, the Mark button (v0.45.1; the user, 2026-10-25: "the
 * idea is to get to one line, text field, button, button. The text field when not in the pen is the director calls.
 * When in the pen it cycles through 3 or four messages, OBS status, event name, card, maybe bike"). Pure: meters.mjs
 * puts the words on the page.
 *
 *   recButton({recording, startedAt, saving, now}) -> {text, on}     the Record button: "● 12:03" while recording
 *   eventText({eventName, subgroup, routeName, routeId, inEvent})     the event with its category, else the route
 *   cardText({cardName, inEvent})                                     "card: …" / "no race card" (null outside events)
 *   bikeText(bike, wheels)                                            "bike: Halo · deep wheels" (BIKES / WHEELS entries)
 *   inPen(me) -> you are in an event that hasn't got going yet (the pen)
 *   cycleText(messages, now) -> one message at a time, CYCLE_S each (empty ones skipped)
 */

export const CYCLE_S = 4;

const clock = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export function recButton({recording = false, startedAt = null, saving = false, now = Date.now()} = {}) {
    if (recording) return {text: `● ${clock(now - (startedAt ?? now))}`, on: true};
    return {text: saving ? 'Saving…' : 'Record', on: false};
}

export function eventText({eventName = null, subgroup = null, routeName = null, routeId = null, inEvent = false} = {}) {
    if (inEvent && eventName) return `${eventName}${subgroup ? ` (${subgroup})` : ''}`;
    return routeName || (routeId != null ? 'route…' : 'no route');
}

export function cardText({cardName = null, inEvent = false} = {}) {
    return cardName ? `card: ${cardName}` : inEvent ? 'no race card' : null;
}

// the bike's short name: the label up to its list of examples ("Halo: PROJECT 74, R4000" -> "Halo")
export function bikeText(bike, wheels) {
    if (!bike) return null;
    const name = String(bike.label || bike.id).split(/[:(]/)[0].trim();
    return `bike: ${name}${wheels && wheels.short ? ` · ${wheels.short}` : ''}`;
}

export function inPen(me) {
    const s = me && me.state;
    if (!s || !s.eventSubgroupId) return false;
    return !(Number.isFinite(s.eventDistance) && s.eventDistance > 0);
}

export function cycleText(messages, now = Date.now()) {
    const list = (messages || []).filter(Boolean);
    if (!list.length) return null;
    return list[Math.floor(now / (CYCLE_S * 1000)) % list.length];
}
