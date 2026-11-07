/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Segment cards in a free ride (the user, 2026-11-02: jersey hunting happens there). A card's km are race distances, so
 * outside an event it has no idea where you are. Its item's segmentId does: Sauce knows that segment's road, direction
 * and start (rpc.getSegment), and the road's real curve gives the meters to its banner (road-map.mjs metersAt). Against
 * the odometer on 58 recorded passes: within about 10 m at jump distance. Those meters become the race distance the
 * card's own calls expect, so "go in 10" and "go, 750" work as they do in a race.
 *
 * Any route will do: you reach a segment however you like, so the card matches on the segment, not on its route. It's
 * assumed contested (a plan of skip on the Race card tab says no): no keyboard mid-ride, and a recording costs nothing.
 * With two cards for a segment, the normal one and the U-turn one, a recent turn picks the U-turn card; riding the road
 * the other way with a U-turn card on it calls the turn (advice only, like every call).
 * A pass reports itself to onPass: arm (coming up), banner, line, abort; the window records and marks it.
 * Pure (no DOM, no Sauce).
 */
import {cardCall, planFor, usableItem, uTurnCall, spotCall, itemKey, PRIORITY, PACE_WARN_S} from './engine/race-card.mjs';
import {metersAt, roadPercent} from './engine/road-map.mjs';

export const SEGMENT_LOOK_M = 1500;   // the card's calls start this far before the banner, at most
export const SEGMENT_ARM_M = 600;     // a pass begins this far before it (a recording starts)
export const TURN_MEMORY_S = 180;     // a U-turn this recent means you're on the U-turn card
export const ARM_TIMEOUT_S = 240;     // armed and no banner: you went somewhere else
// A standing start (card 1.2, pacing.start): "stop" puts you on the spot (the user, 2026-11-02: wait at a known place,
// brakes on). Any moving rider is draftable (the user, 2026-11-03): you gain while you close on one, then pass. So there
// the director tries going now, in 1 s, in 2 s…, and says go at the first moment that has you passing the most riders
// between your jump and the line: the card's trace says where you'll be each second after go, each rider is where they
// are now plus their speed (on the user's recordings, 30 s out, half within 2.6 s and 80% within 6 s). No physics here.
export const STOP_ZONE_M = 60;        // stopped this close to the spot counts as on it
export const STOPPED_MS = 1;          // slower than this is stopped
export const TRAFFIC_M = 2000;        // riders this far either way on your road count
export const MAX_WAIT_S = 180;        // go moments looked at, from now

/*
 * Meters before the banner of a segment, in the direction it runs, for a rider anywhere on its road; below 0 = past it.
 * The rider's own direction doesn't matter: it's a place. A looped road takes the short way round.
 */
export function toBannerM(seg, road, s) {
    const p = roadPercent(s);
    if (p == null) return null;
    const here = metersAt(road, p), banner = metersAt(road, seg.roadStart);
    let d = seg.reverse ? here - banner : banner - here;
    if (road.looped) {
        const len = metersAt(road, 1) - metersAt(road, 0);
        if (d < -len / 2) d += len;
        else if (d > len / 2) d -= len;
    }
    return d;
}

export class SegmentCards {
    /*
     * cards() -> the imported cards; segment(id) -> Promise of Sauce's segment; roadMap: road-map.mjs RoadMap;
     * planFor(cardId) -> your plan for that card; onPass({kind, card, item, uturn}).
     */
    constructor({cards = () => [], segment, roadMap, planFor: planOf = () => ({}), onPass = () => {}}) {
        this.cards = cards;
        this.segment = segment;
        this.roadMap = roadMap;
        this.planOf = planOf;
        this.onPass = onPass;
        this.entries = null;     // [{card, item, seg}]
        this.loading = false;
        this.pass = null;        // {id, phase: 'armed' | 'in', atWt, entry, uturn}
        this.last = null;        // your last road and direction
        this.turnedWt = null;    // worldTime of your last U-turn
        this.gaveUp = null;      // the segment whose pass timed out
        this.went = new Set();   // segments whose standing start has had its go
    }

    /* Waiting on the spot: when to go to pass the most riders between your jump and the line. */
    _goCall(entry, seg, road, s, dMe, {riders = [], leadS = 0}) {
        const st = entry.item.pacing.start, it = entry.item, key = itemKey(it);
        const call = {id: 'card', priority: PRIORITY.pace, about: 'pace', item: it};
        const ready = text => ({...call, say: 'go when ready', state: `pace-${key}-ready`, text: `${it.name}: ${text}`});
        const trace = Array.isArray(st.trace) && st.trace.length > 1 ? st.trace.map(d => d + (dMe - st.trace[0])) : null;
        if (!trace) return ready('go when ready');
        const lengthM = Number(seg.distance) || (Number(it.lengthKm) || 0) * 1000;
        const jumpAt = Number.isFinite(it.pacing.parts?.[0]?.atM) ? -it.pacing.parts[0].atM : 0;   // meters before the banner
        const others = [];
        for (const o of riders || []) {
            const q = o && o.state;
            if (!q || o.self || q.roadId !== s.roadId || !!q.reverse !== !!s.reverse || (q.courseId != null && q.courseId !== s.courseId)) continue;
            const v = (q.speed || 0) / 3.6, d = toBannerM(seg, road, q);
            if (v < 2 || d == null || d < -lengthM || Math.abs(d - dMe) > TRAFFIC_M) continue;
            others.push({d, v});
        }
        let bestN = 0, bestDelay = null;
        for (let delay = 0; delay <= MAX_WAIT_S; delay++) {
            let n = 0;
            for (const o of others) {
                // the second you go past them: you behind a moment ago, level or ahead now. It counts if it's in your sprint
                for (let k = 1; k < trace.length; k++) {
                    const was = trace[k - 1] - (o.d - o.v * (delay + k - 1)), now = trace[k] - (o.d - o.v * (delay + k));
                    if (was > 0 && now <= 0) {
                        if (trace[k] <= jumpAt && trace[k] >= -lengthM) n++;
                        break;
                    }
                }
            }
            if (n > bestN) {
                bestN = n;
                bestDelay = delay;
            }
        }
        if (bestDelay == null) return ready(others.length ? 'nobody to catch in the sprint, go when ready' : 'nobody around, go when ready');
        const goIn = bestDelay - leadS, who = `${bestN} rider${bestN > 1 ? 's' : ''}`;
        if (goIn <= 0) return {...call, say: `go, ${Math.round(st.goW / 10) * 10}`, state: `pace-${key}-go`, text: `${it.name}: go (${who} to catch)`, go: true};
        if (goIn <= PACE_WARN_S) return {...call, say: 'go', state: `pace-${key}-go-prep`, text: `${it.name}: go in ${Math.round(goIn)} s (${who})`, inS: goIn};
        return {...call, say: 'wait', state: `pace-${key}-wait`, text: `${it.name}: wait, ${who} to catch if you go in ${Math.round(goIn)} s`, inS: goIn};
    }

    /* Look again on the next tick (an import or a removal). */
    refresh() {
        this.entries = null;
    }

    _load() {
        if (this.entries || this.loading) return;
        const items = (this.cards() || []).flatMap(card => (card.items || []).filter(it => it.segmentId != null && usableItem(it)).map(item => ({card, item})));
        this.loading = true;
        Promise.all(items.map(x => Promise.resolve().then(() => this.segment(x.item.segmentId)).then(seg => ({...x, seg})).catch(() => ({...x, seg: null}))))
            .then(list => {
                this.entries = list.filter(x => x.seg && Number.isFinite(x.seg.roadStart));
            })
            .catch(e => console.warn('segment cards', e))
            .finally(() => {
                this.loading = false;
            });
    }

    _noteTurn(s) {
        const l = this.last;
        if (l && l.roadId === s.roadId && l.reverse !== !!s.reverse) this.turnedWt = s.worldTime;
        this.last = {roadId: s.roadId, reverse: !!s.reverse};
    }

    _turned(s) {
        return this.turnedWt != null && Number.isFinite(s.worldTime) && (s.worldTime - this.turnedWt) / 1000 <= TURN_MEMORY_S;
    }

    _tell(kind, entry, uturn) {
        this.onPass({kind, card: entry.card, item: entry.item, uturn});
    }

    _armed(id, entry, uturn, s) {
        if (this.pass || this.gaveUp === id) return;
        this.pass = {id, phase: 'armed', atWt: s.worldTime, entry, uturn};
        this._tell('arm', entry, uturn);
    }

    /*
     * Your card's call now, or null. s: your state; {v (m/s), held, tt, leadS (say it this early), turnLeadS (a U-turn),
     * riders (Sauce's nearby list: who's coming, for a standing start)}.
     */
    call(s, {v = 0, held = null, tt = false, leadS = 0, turnLeadS = 0, riders = []} = {}) {
        if (!s || s.eventSubgroupId) return null;
        this._load();
        this._noteTurn(s);
        this.roadMap.ensure(s.courseId);
        const road = this.roadMap.road(s.courseId, s.roadId);
        const here = (this.entries || []).filter(x => x.seg.roadId === s.roadId && (x.seg.courseId == null || x.seg.courseId === s.courseId));
        const p = this.pass;
        if (p && p.phase === 'armed' && Number.isFinite(s.worldTime) && (s.worldTime - p.atWt) / 1000 > ARM_TIMEOUT_S) {
            this.pass = null;
            this.gaveUp = p.id;   // stopped on the way in: not armed again until you've gone away (a recording every 4 min)
            this.went.delete(p.id);
            this._tell('abort', p.entry, p.uturn);
        }
        if (!road || !here.length) return null;
        let best = null;
        for (const id of new Set(here.map(x => x.seg.id))) {
            const cards = here.filter(x => x.seg.id === id);
            const seg = cards[0].seg, d = toBannerM(seg, road, s);
            if (d == null) continue;
            const isTurnCard = x => !!x.item.pacing?.uturn;
            const lengthM = Number(seg.distance) || (Number(cards[0].item.lengthKm) || 0) * 1000;
            if (!!s.reverse !== !!seg.reverse) {
                // the other way: on the way to the turn
                const entry = cards.find(isTurnCard);
                if (!entry || planFor(entry.item, this.planOf(entry.card.id)) === 'skip') continue;
                if (d > -lengthM - 200) {
                    // you're at -d from the banner, riding toward lower numbers; the turn is at turnAtM (below 0)
                    const c = uTurnCall(entry.item, {toTurnM: -d - entry.item.pacing.uturn.turnAtM, v, leadS: leadS + turnLeadS});
                    if (c) {
                        this._armed(id, entry, true, s);
                        if (!best || c.priority > best.priority) best = c;
                    }
                }
                continue;
            }
            const turned = this._turned(s);
            const isStartCard = x => !!x.item.pacing?.start;
            const entry = (turned ? cards.find(isTurnCard) : cards.find(isStartCard) || cards.find(x => !isTurnCard(x))) || cards[0];
            const plan = this.planOf(entry.card.id) || {};
            if (this.gaveUp === id && d > SEGMENT_ARM_M) this.gaveUp = null;
            if (planFor(entry.item, plan) === 'skip' || d > SEGMENT_LOOK_M) continue;
            const pass = this.pass && this.pass.id === id ? this.pass : null;
            if (d > 0 && d <= SEGMENT_ARM_M) this._armed(id, entry, isTurnCard(entry), s);
            if (pass && pass.phase === 'armed' && d <= 0) {
                pass.phase = 'in';
                this._tell('banner', entry, pass.uturn);
            }
            if (d <= -lengthM) {
                if (pass) {
                    this.pass = null;
                    this._tell('line', entry, pass.uturn);
                }
                this.went.delete(id);
                continue;
            }
            // a standing start: "stop" on the way to the spot; on it, wait for the traffic and "go"; after that, the plan
            if (isStartCard(entry) && !this.went.has(id)) {
                const stopAt = -entry.item.pacing.start.waitAtM;
                if (v < STOPPED_MS && Math.abs(d - stopAt) <= STOP_ZONE_M) {
                    if (pass) pass.atWt = s.worldTime;   // waiting is not going somewhere else
                    else this._armed(id, entry, false, s);
                    const c = this._goCall(entry, seg, road, s, d, {riders, leadS});
                    if (c.go) this.went.add(id);
                    if (!best || c.priority > best.priority) best = c;
                    continue;
                }
                if (v >= STOPPED_MS && d > stopAt) {
                    const c = spotCall(entry.item, {toM: d - stopAt, v, leadS, say: 'stop', tag: 'stop'});
                    if (c && (!best || c.priority > best.priority)) best = c;
                    continue;
                }
            }
            const c = cardCall({card: {items: [entry.item]}, plan, edM: entry.item.km * 1000 - d, v, held, tt, leadS});
            if (c && c.state && (!best || c.priority > best.priority)) best = c;
        }
        return best;
    }
}
