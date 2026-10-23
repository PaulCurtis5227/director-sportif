/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The bike check (v0.62.0): Sauce doesn't say which bike you ride, so the meters use the bike you set, and a set bike
 * outlives the ride it was set for (user, 2026-10-14: the 2026-10-13 TTT was ridden on the Speedmax CFR + CADEX
 * disc while the Data Tap still had the Tarmac SL9: ~14% too much drag, Holding read ~−50 W all race). So when you
 * join an event the mods show (and say) the bike they will use and ask; in a time trial a bike that isn't a TT bike
 * is a warning. Pure (no DOM, no Sauce); used by the Data Tap and the Director Sportif mod (engine copy).
 */

/* 'ttt' | 'tt' | null from an event's name. */
export function eventKind(name) {
    const s = String(name || '');
    if (/\bTTT\b|team time[ -]?trial/i.test(s)) return 'ttt';
    if (/\bI?TT\b|time[ -]?trial|chrono/i.test(s)) return 'tt';
    return null;
}

/*
 * What to show and say. bike: the setup in words ("Tarmac SL9 · stage 4 · Reserve Infinity"); sayName: the short
 * spoken name ("Tarmac SL9"); isTT: the set bike is a TT bike; eventName may still be null (it arrives later).
 */
export function bikeCheckText({bike, sayName = bike, isTT = false, eventName = null, missing = false}) {
    const kind = eventKind(eventName);
    if (missing) {
        return {warn: true, text: 'No bike set: pick the bike you ride, or the meters guess',
                say: 'No bike set. Pick your bike.'};
    }
    if (kind && !isTT) {
        const what = kind === 'ttt' ? 'Team time trial' : 'Time trial';
        return {warn: true, text: `${what}, but the bike is ${bike}: right?`,
                say: `${what}. Bike set to ${sayName}. Check it.`};
    }
    return {warn: false, text: `Bike: ${bike}: right?`, say: `Bike: ${sayName}. Right?`};
}

/* The recent setups, most recent first, without repeats (setup: a plain object; compared by its fields). */
export function rememberSetup(list, setup, max = 4) {
    if (!setup) return Array.isArray(list) ? list : [];
    const key = x => JSON.stringify(Object.keys(x).sort().map(k => [k, x[k]]));
    const k = key(setup);
    return [setup, ...(Array.isArray(list) ? list : []).filter(x => x && key(x) !== k)].slice(0, max);
}

/* Once per event: true the first time a given event (eventSubgroupId) is seen. */
export class BikeCheckWatch {
    constructor() {
        this.seen = new Set();
        this.sg = null;
    }

    update(sg) {
        sg = sg || null;
        const changed = sg !== this.sg;
        this.sg = sg;
        if (!sg || !changed || this.seen.has(sg)) return false;
        this.seen.add(sg);
        return true;
    }
}
