/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Director Sportif window (v0.20.0: the control window; the meters are on the Grid, grid.mjs): it runs the engine
 * on Sauce's `nearby` list (meter-engine.mjs), builds the data object (ds-data.mjs, docs/DS-DATA.md) and posts it on a
 * BroadcastChannel (CHANNEL) for the Grid, delivers the calls (voice, chime, messages), asks the bike check, and shows a
 * small status panel: the call now, the route and race card, whether data is coming. Keep it open: no engine, no data.
 * v0.21.0: it records in the capture format (capture.mjs, docs/CAPTURE.md): Record / Mark buttons, every event by
 * itself when the setting is on, stored crash-safe every 30 s (engine/checkpoint.mjs), saved to Downloads on Stop.
 * v0.22.0: the OBS link (engine/obs-client.mjs, video-clock.mjs): when your recording / stream started goes into the
 * recording, so report moments become links into your video (docs/PLAN.md §4, §11); OBS can record with the race.
 * v0.23.0: crude tables for pack cost and the draft-by-gap curve (engine/pack-cost.mjs, gap-curve.mjs: the mod's own,
 * no learning, so nothing is kept between rides). v0.23.1: boxed in with room ahead costs 13 W, not 29.
 * v0.24.0: the supertuck call only in race events (the event's type, looked up once per event: raceFor).
 * v0.24.1: no "keep going" / "dig in" once the sprint is settled (engine/director.mjs sprintSettled).
 * v0.25.0: the sprint window ("you can go", target watts to the line leaving 3 kJ) and "take the wheel" before it.
 * v0.25.1: "take the wheel" only for a rider 4–8 km/h faster (a faster one before the window: no call).
 * v0.26.0: settings apply without a reload (a reload ended the recording and lost the OBS recording it started; that
 * OBS was ours is kept across a reopen); "take the wheel" only in the last km and its own call type (a chime by
 * default); "ease off" once your place is safe after your jump; no "keep going" at 1.5× FTP+; the Flyer field (a rider
 * up the road: caught where, or away, on an assumed FRC for others, setting 20 kJ; shown, not spoken); "gap opening"
 * (position.mjs GapWatch: the hole in front of your wheel or the next opens; call type `gap`, beats "back off").
 * v0.27.0: "ease to FTP" before "ease off" (engine/director.mjs easeCall: settled while you ride FTP, chasers finding
 * what they really found), and both at the intermediate sprints you contest on the race card (IntermediateCoach);
 * "take the wheel" is now "wheel, jump light / medium / hard" at the moment to go (engine/director.mjs wheelJump).
 * v0.27.1: "Record OBS with the race" starts OBS only for a recording that starts in an event (not a free-ride Record).
 * v0.28.0: the title card (title.html, engine/title-card.mjs from the Efficiency Meter): the video opens on the event, the
 * course and your plan for obsTitleS, in this mod's own OBS scene, then cuts back to your scene; a Rehearse button
 * (settings ▸ OBS) runs title + OBS + a 90 s recording with no race, to test against your OBS.
 * v0.28.1: no "gap opening" under 5 km/h (the rehearsal at the roadside: riders passing looked like a gap); auto-record
 * no longer takes an event with no set end as finished (engine/auto-record.mjs sawLeft), and says why it waits; the
 * data subscription is persistent (Sauce's auto-hide hid the window in the pen and paused everything: no auto-record,
 * no OBS, no calls until it showed), and the auto-record check runs on your ticks too.
 * v0.28.2: the Race card tab opens on the card you picked last. v0.28.3: kept in plain localStorage (it didn't survive a
 * Sauce restart in the settings store).
 * v0.29.0: race day (into the pen 30 min early, out to warm up, back in): the auto-record (and OBS + title) starts 5 min
 * before the event's start, not on joining; an event left before it got going starts again when you're back.
 * v0.30.0: the Flyer field put aside (it read other riders' power and FTP: more exposed than we want) and no more Zwift
 * messages to yourself (the voice, the chime and the windows do the same).
 * v0.31.0: Position is absolute: watts short of the ideal spot at your speed (0 = nothing to gain), colors 7 / 28 W;
 * the Demand field: the power the ideal spot needs to hold your group, 30 s, with % of FTP (engine/position.mjs).
 * v0.32.0: Demand counts speeding up and slowing down over its 30 s (off a fast descent it read 490 W while the bunch
 * coasted at 100); the race index (race-index.mjs): YouTube chapters for the OBS recording, saved to Downloads as
 * ds-video-<time>-youtube-chapters.txt when OBS stops (a rehearsal makes one too).
 * v0.33.0: All words (Grid, Words group): the call and every meter's advice in one tile, like the old messages to
 * yourself; advice only (no descriptions like "boxed" or "beside"), each word up for 3 s at least.
 * v0.34.0 (2026-10-23 group ride + TT free ride): "Record all the time" (a file per free ride, events still in their
 * own); finish calls in events only (a free ride's route end queued the finish again); no power-up calls on a TT bike
 * (lost at the next arch, Sauce still shows it); "last wheel, be ready" (was "go first") timed by the road ahead's
 * seconds, 15–80 s (1000 m with a climb was 119 s); their wind-up is "jump now" (was "go wide", the passing cue's word);
 * the passing cue's "go wide" is no longer called (shown only): ~40 an hour on pack yo-yo, rarely before a hold; the sprint calls say "up the edge" (was "wide": the edge keeps the draft).
 * v0.35.0: race cards can be imported (Race card tab: Import a card / Remove; race-cards-live.mjs importCard): a file
 * from caffecter.com's race card maker or written by hand, kept in localStorage (IMPORTED_CARDS_KEY), used like the
 * shipped cards; the main window hears an import at once (storage event -> RaceCards.refresh).
 * v0.36.0: the OBS title card advertises the Director Sportif as free, with caffecter.com (race cards, ride reports).
 * v0.40.0: auto-record remembers across a window reopen which events it recorded and which you finished (AUTO_STATE_KEY):
 * no second recording of a finished event, and "Record OBS with the race" never starts OBS for one (2026-10-24).
 * v0.41.0: the gap curve's too-close penalty grows as speed² (engine/gap-curve.mjs PENALTY_EXP; measured on descents);
 * "give room" (a habit), the feather call, and draftless is its own state (Position's no-draft wheel said "change wheel").
 * v0.42.0: Blocked counts spikes on fast descents again within 5.5 m of the wheel (engine/blocking.mjs FAST_DESCENT_CLOSE_M):
 * there they are the cost of sitting close (research/2026-10-24/pack-speed.mjs), not the draft swinging.
 * v0.43.0: a fresh install speaks the main calls (calls.mjs FRESH_VOICE); existing riders keep their own choices.
 * v0.44.0: the window's big line is All words (the call and each meter's advice, grid-fields.mjs allWords, yellow /
 * red when urgent): one place to look (the user: words spread over many meters "aren't where you are looking"); the
 * "open the Grid" hint goes once a Grid has said hello (GRID_SEEN_KEY).
 */

import * as Common from '/pages/src/common.mjs';
import {MeterEngine} from './meter-engine.mjs';
import {RoadMap} from './engine/road-map.mjs';
import {riderModel, BIKES, DEFAULT_BIKE, WHEELS, DEFAULT_WHEELS} from './rider-model.mjs';
import {setStyles, windowFitter, options} from './window-ui.mjs';
import {Speaker} from './engine/speech.mjs';
import {bikeCheckText} from './engine/bike-check.mjs';
import {engineCall, Announcer, CALL_TYPES, deliveryGridHTML, deliveryDefaults, deliveryFor}
    from './calls.mjs';
import {buildData, CHANNEL} from './ds-data.mjs';
import {allWords} from './grid-fields.mjs';
import {RouteAhead} from './route-ahead.mjs';
import {RaceCards, cardEntries, loadEntry, importCard} from './race-cards-live.mjs';
import {CaptureRecorder} from './capture.mjs';
import {Checkpoint, idbStore, leftovers, recoveredBlob, CHECKPOINT_S} from './engine/checkpoint.mjs';
import {AutoRecord} from './engine/auto-record.mjs';
import {ObsClient} from './engine/obs-client.mjs';
import {VideoClock, obsActive} from './video-clock.mjs';
import {titleQuery, prepareTitle, showTitle, hideTitle} from './engine/title-card.mjs';
import {rehearsalPlan} from './engine/chapters.mjs';
import {RaceIndex} from './race-index.mjs';

export const DS_VERSION = '0.44.0';
const RESULT_TRIES = 4, RESULT_WAIT_MS = 3000;   // your result: asked up to 4 times, 3 s apart, when the recording stops
// Zwift's event types with race physics (Sauce src/stats.mjs eventRaceTypes)
const RACE_EVENT_TYPES = new Set(['RACE', 'TIME_TRIAL', 'TEAM_TIME_TRIAL']);
const OBS_RETRY_MS = 30_000;   // = manifest.json (test/capture.test.mjs)
const CAPTURE_STORE = 'ds-captures';
// The title card (engine/title-card.mjs): this mod's own OBS scene and Browser source, and the page they show
const DS_TITLE = {scene: 'Director Sportif: title', input: 'Director Sportif title card', path: '/mods/director-sportif/pages/title.html'};
export const REHEARSAL_S = 90;   // a rehearsal records this long after the title
// settings window -> this window: rehearse ({at, cardId}); this window -> settings window: OBS status ({text, rehearsing})
export const REHEARSE_KEY = 'director-sportif-obs-rehearse';
export const OBS_STATUS_KEY = 'director-sportif-obs-status';
// the scene to go back to while the title is up ({scene, until}): a window closed mid-title switches back on reconnect
const TITLE_BACK_KEY = 'director-sportif-obs-title-back';
// the race index (YouTube chapters) of the video OBS is recording: kept across a window reopen mid-race
const RACE_INDEX_KEY = 'director-sportif-race-index';

/* A file to Downloads (Sauce's windows save downloads there). */
function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = (ms = Date.now()) => {
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
import {loadIndex, itemKey, planFor, powerFor, PLANS_SEGMENT, PLANS_ARCH} from './engine/race-card.mjs';

const fetchJSON = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));
const cardPlanKey = id => `raceCardPlan-${id}`;   // your plan per card: this computer only (the cards are facts)
// The card last picked on the Race card tab (and rehearsed). Plain localStorage, like the bike check: Sauce's settings
// store didn't bring it back after a Sauce restart (2026-10-19, cause not found; its store is per window id).
const CARD_PICKED_KEY = 'director-sportif-race-card-picked';
// Race cards the rider imported (race-cards-live.mjs importCard): plain localStorage for the same reason, shared by
// both windows; the settings window imports, this window hears it (storage event) and looks for the card again
const IMPORTED_CARDS_KEY = 'director-sportif-imported-cards';
const importedCards = () => {
    try { return JSON.parse(localStorage.getItem(IMPORTED_CARDS_KEY)) || []; } catch (e) { return []; }
};
const saveImportedCards = list => localStorage.setItem(IMPORTED_CARDS_KEY, JSON.stringify(list));

const doc = document.documentElement;
// The event the bike was last checked for (plain localStorage: picking a bike reloads the window)
const BIKE_CHECKED_KEY = 'director-sportif-bike-checked';
const STALE_MS = 5000;   // no data for this long: waiting for Zwift

export const SETTING_DEFAULTS = {
    solidBackground: false,
    backgroundColor: '#00ff00',
    fitWindow: true,     // size the window to the status panel
    textScale: 100,
    // see-through like Sauce's grid; mouse over shows the window (Sauce themes.scss). '' = the app's theme
    themeOverride: 'transparent-dark',
    bike: DEFAULT_BIKE,
    wheels: DEFAULT_WHEELS,
    aeroSocks: false,
    myCda: null,
    myFtpW: null,        // empty: your Zwift profile's FTP
    myFrcKJ: 15,
    autoRecordEvents: false,   // record every event you join (capture format); you turn it on
    recordAlways: false,       // and record all the time outside events (a file per free ride; you turn it on)
    obsEnabled: false,         // connect to OBS (its WebSocket server) for the video clocks
    obsUrl: 'ws://127.0.0.1:4455',
    obsPassword: '',           // OBS's WebSocket password: kept in this window's settings on this computer
    obsRecordWithRace: false,  // start / stop OBS recording with the Director Sportif's recording
    obsTitleS: 15,             // the video opens on the title card this long (0 = none)
};

/*
 * Fill in missing settings one key at a time. Never settingsStore.setDefault(): it only writes into an empty store,
 * so settings added in a later version would stay undefined for everyone who already saved once. The per-type call
 * delivery (v0.9.0) starts from the old single switches (speakCalls, speechChime, selfMessages), if any.
 */
function applyDefaults() {
    for (const [k, v] of Object.entries(SETTING_DEFAULTS)) {
        Common.settingsStore.get(k, v);
    }
    const s = Common.settingsStore.get();
    // Sauce read the theme before the default above was written
    if (s.themeOverride) doc.dataset.theme = s.themeOverride;
    for (const [k, v] of Object.entries(deliveryDefaults(s))) {
        Common.settingsStore.get(k, v);
    }
}

/*
 * The bike check (engine/bike-check.mjs): Sauce doesn't say which bike you ride, so on joining an event the window
 * shows the bike type the meters use, with a dropdown to change it (a TT bike in a time trial; user, 2026-10-14).
 * Once per event; gone once answered or a minute into the race.
 */
function bikeChecker({speak, refit, onBike}) {
    const box = document.querySelector('#bike-check');
    const text = box.querySelector('.text');
    const sel = box.querySelector('select');
    let sg = null, eventName = null, said = null, open = false;
    const checked = () => {
        try { return localStorage.getItem(BIKE_CHECKED_KEY); } catch (e) { return null; }
    };
    const markChecked = () => {
        try { localStorage.setItem(BIKE_CHECKED_KEY, String(sg)); } catch (e) { /* asks again after a reload */ }
    };
    const close = () => {
        open = false;
        box.hidden = true;
        refit();
    };
    const render = () => {
        const bike = Common.settingsStore.get('bike') || DEFAULT_BIKE;
        const b = BIKES.find(x => x.id === bike) || BIKES[0];
        const c = bikeCheckText({bike: b.label, sayName: b.label.replace(/ \(.*\)$|:.*$/, ''), isTT: b.id === 'tt', eventName});
        text.textContent = c.text;
        box.classList.toggle('warn', c.warn);
        sel.value = b.id;
        box.hidden = false;
        open = true;
        refit();
        if (c.say !== said) {
            said = c.say;
            speak(c.say);
        }
    };
    sel.innerHTML = options(BIKES, Common.settingsStore.get('bike') || DEFAULT_BIKE);
    sel.addEventListener('change', () => {
        markChecked();
        Common.settingsStore.set('bike', sel.value);   // the model reads it on every tick (main: settings)
        onBike(sel.value);
        close();
    });
    box.querySelector('.ok').addEventListener('click', () => {
        markChecked();
        close();
    });
    return {
        update(me) {
            const s = me && me.state;
            if (!s || !me.self) return;
            const id = s.eventSubgroupId || null;
            if (id !== sg) {
                sg = id;
                eventName = null;
                said = null;
                const started = Number.isFinite(s.eventDistance) && s.eventDistance > 1;
                if (id && !started && checked() !== String(id)) {
                    render();
                    Promise.resolve().then(() => Common.rpc.getEventSubgroup(id))
                        .then(x => x && x.eventId != null ? Common.rpc.getEvent(x.eventId) : null)
                        .then(e => {
                            if (sg === id && open && e && e.name) {
                                eventName = e.name;
                                render();
                            }
                        }).catch(e => console.warn('event name', e));
                } else if (open) {
                    close();
                }
            } else if (open && Number.isFinite(s.eventDistance) && s.eventDistance > 500) {
                close();   // the race is under way
            }
        },
    };
}

export async function main() {
    Common.initInteractionListeners();
    applyDefaults();
    const settings = Common.settingsStore.get();
    setStyles(settings, 1);
    const content = document.querySelector('#content');
    const el = {
        word: content.querySelector('.call-word'),
        state: content.querySelector('.state'),
        route: content.querySelector('.route'),
    };
    const fitter = windowFitter(content, {extras: () => [document.querySelector('#bike-check')]});
    let fitCheckAt = 0;
    const fitWindow = () => {
        if (Common.settingsStore.get('fitWindow') !== false) fitter.fit();
    };
    let anyVoice = false;
    requestAnimationFrame(fitWindow);

    const raceCards = new RaceCards({fetchJSON,
                                     routeName: routeId => Common.getRoute(routeId, {prelude: 'leadin'}).then(r => r && r.name),
                                     planFor: id => Common.settingsStore.get(cardPlanKey(id)) || {},
                                     imported: importedCards});
    window.addEventListener('storage', ev => {
        if (ev.key === IMPORTED_CARDS_KEY) raceCards.refresh();
    });
    // Race or not, per event (eventSubgroupId): looked up once; no event = not a race (free ride)
    const eventTypes = new Map();   // subgroup id -> eventType | 'pending' | null (lookup failed)
    const raceFor = me => {
        const sg = me && me.state && me.state.eventSubgroupId;
        if (!sg) return false;
        if (!eventTypes.has(sg)) {
            eventTypes.set(sg, 'pending');
            Promise.resolve().then(() => Common.rpc.getEventSubgroup(sg))
                .then(x => x && x.eventId != null ? Common.rpc.getEvent(x.eventId) : null)
                .then(e => eventTypes.set(sg, (e && e.eventType) || null))
                .catch(e => {
                    eventTypes.set(sg, null);
                    console.warn('event type', e);
                });
        }
        const t = eventTypes.get(sg);
        return t && t !== 'pending' ? RACE_EVENT_TYPES.has(t) : null;
    };
    const engine = new MeterEngine({
        raceFor,
        modelFor: me => riderModel({athlete: me.athlete, bike: settings.bike, wheels: settings.wheels,
                                    socks: settings.aeroSocks, myCda: settings.myCda}),
        // Road surfaces from Zwift's map (dirt, wood, brick… roll slower than pavement)
        roadMap: new RoadMap(courseId => Common.rpc.getCourseRoads(courseId)),
        // Your route ahead, from Sauce's route data (as its elevation window builds it): climbs seen alone, from the start
        routeAhead: new RouteAhead(routeId => Common.getRoute(routeId, {prelude: 'leadin'})),
        // The race card for your event's route, with your plan from the settings window
        raceCards,
        // Your FTP and FRC for the FRC meter (settings; FTP from your Zwift profile when not set)
        fitnessFor: me => ({ftpW: Number(settings.myFtpW) > 0 ? Number(settings.myFtpW) : me.athlete && me.athlete.ftp,
                            frcJ: (Number(settings.myFrcKJ) > 0 ? Number(settings.myFrcKJ) : 15) * 1000}),
    });
    // Calls (calls.mjs): each type delivered as its settings say (text / chime / voice).
    const delivery = {};
    const readDelivery = () => {
        for (const t of CALL_TYPES) delivery[t.id] = deliveryFor(settings, t.id);
        anyVoice = CALL_TYPES.some(t => delivery[t.id].voice);
    };
    readDelivery();
    // A setting changed in the settings window: applied here, never by reloading (v0.26.0: a reload ended the recording
    // and lost the OBS recording it had started; the user, 2026-10-19). The model, FTP / FRC and the plan read
    // `settings` / the store on every tick.
    Common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) {
            return;
        }
        Object.assign(settings, Common.settingsStore.get());
        const key = ev.data.key;
        if (['backgroundColor', 'solidBackground', 'backgroundAlpha', 'textScale', 'fitWindow'].includes(key)) {
            setStyles(settings, 1);
            requestAnimationFrame(fitWindow);
        } else if (/^call[A-Z]/.test(key)) {
            readDelivery();
        } else if (['obsEnabled', 'obsUrl', 'obsPassword'].includes(key)) {
            obsReconnect();
        }
    });
    const speaker = new Speaker();
    const announcer = new Announcer();
    const bikeCheck = bikeChecker({speak: text => { if (anyVoice) speaker.utter(text); }, onBike: id => { settings.bike = id; },
                                   refit: () => requestAnimationFrame(fitWindow)});
    // The data object goes out to the Grid and any other window of ours: docs/DS-DATA.md "Transport"
    let channel = null;
    try {
        channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
    } catch (e) {
        console.warn('data channel', e);
    }
    // the "open the Grid" hint: gone once a Grid has said hello (grid.mjs posts it as it opens), and from then on
    const hint = content.querySelector('.hint');
    const GRID_SEEN_KEY = 'director-sportif-grid-seen';
    try { if (localStorage.getItem(GRID_SEEN_KEY)) hint.hidden = true; } catch (e) { /* no storage: shown */ }
    if (channel) {
        channel.addEventListener('message', ev => {
            if (!ev.data || ev.data.type !== 'hello' || hint.hidden) return;
            hint.hidden = true;
            try { localStorage.setItem(GRID_SEEN_KEY, '1'); } catch (e) { /* this session only */ }
        });
    }
    const wordsHold = new Map();   // All words: a word stays WORDS_HOLD_S after it goes (grid-fields.mjs allWords)
    // The status panel: what the engine is doing, the route and card, the call now (the meters are on the Grid)
    let lastTick = 0, routeId = null, routeName = null;
    const setText = (node, text) => {
        if (node.textContent !== text) node.textContent = text;
    };
    let mySg = null;   // your event (eventSubgroupId) on the last tick of yours; null = free ride
    let myName = null;
    // the event's name, category and start for the title card: looked up once per event
    let evInfo = {sg: null, ready: Promise.resolve(null), at: 0, done: true, value: null};
    // the event's start for the auto-record: ms, 'pending' (being looked up, up to 10 s) or null (not known: no wait)
    const eventStart = sg => {
        if (!sg || evInfo.sg !== sg) return 'pending';
        if (evInfo.done) return evInfo.value && Number.isFinite(evInfo.value.startMs) ? evInfo.value.startMs : null;
        return Date.now() - evInfo.at < 10_000 ? 'pending' : null;
    };
    const noteEvent = sg => {
        if (!sg || evInfo.sg === sg) return;
        const info = {sg, at: Date.now(), done: false, value: null};
        evInfo = info;
        info.ready = Promise.resolve().then(() => Common.rpc.getEventSubgroup(sg)).then(async x => {
            const e = x && x.eventId != null ? await Common.rpc.getEvent(x.eventId).catch(() => null) : null;
            const startMs = x && (Number.isFinite(x.ts) ? x.ts : Date.parse(x.eventSubgroupStart));
            return {eventName: (e && e.name) || null, subgroup: (x && x.subgroupLabel) || null, eventType: (e && e.eventType) || null,
                    startMs: Number.isFinite(startMs) ? startMs : null};
        }).catch(e => {
            console.warn('event for the title', e);
            return null;
        }).then(v => {
            info.value = v;
            info.done = true;
            return v;
        });
    };
    let rec = null, cp = null, flushTimer = null, saving = false;   // the recording (below), used by the OBS link too
    let recSg = null;   // the event whose name went into this recording
    let stopping = null;   // the recording being stopped (its result being asked for)
    /*
     * Your result for the report's summary (caffecter.com): your place among the finishers so far (riders finishing
     * later are behind you), how many finished and started. Only counts and your own place: nothing about other riders
     * goes into the recording. Sauce's results are Zwift's, in finishing order; yours may take a few seconds to appear.
     */
    const raceResult = async (sg, myId) => {
        for (let i = 0; i < RESULT_TRIES; i++) {
            const rows = await Common.rpc.getEventSubgroupResults(sg).catch(() => null);
            if (Array.isArray(rows)) {
                const done = rows.filter(x => x && !x.dnf);
                const k = done.findIndex(x => x.profileId === myId);
                if (k >= 0 || i === RESULT_TRIES - 1) {
                    return {sg, place: k >= 0 ? k + 1 : null, finishers: done.length,
                            started: rows.filter(x => x && !x.dns).length,
                            timeMs: k >= 0 && done[k].activityData ? done[k].activityData.durationInMilliseconds ?? null : null};
                }
            }
            await new Promise(res => setTimeout(res, RESULT_WAIT_MS));
        }
        return null;
    };
    // ----- OBS: the video clocks (and recording OBS with the race) -----
    const clock = new VideoClock();
    let obs = null, obsConnecting = false;
    let rehearsal = null;   // a rehearsal running: {cardId, timer}
    // we started OBS's recording: kept in localStorage, so a reopened window still stops it with the race
    const OBS_STARTED_KEY = 'director-sportif-obs-started';
    const obsStarted = {
        get: () => { try { return localStorage.getItem(OBS_STARTED_KEY) === '1'; } catch (e) { return false; } },
        set: on => { try { on ? localStorage.setItem(OBS_STARTED_KEY, '1') : localStorage.removeItem(OBS_STARTED_KEY); } catch (e) { /* no storage */ } },
    };
    const obsState = content.querySelector('.obs-state');
    const showObs = () => {
        if (!Common.settingsStore.get('obsEnabled')) {
            obsState.hidden = true;
            return;
        }
        obsState.hidden = false;
        const mins = ms => `${Math.floor((Date.now() - ms) / 60000)}:${String(Math.floor((Date.now() - ms) / 1000) % 60).padStart(2, '0')}`;
        const parts = [clock.starts.record != null ? `recording ${mins(clock.starts.record)}` : null,
                       clock.starts.stream != null ? `streaming ${mins(clock.starts.stream)}` : null].filter(Boolean);
        setText(obsState, (obs && obs.connected ? `OBS: ${parts.join(' · ') || 'connected'}` : `OBS: ${obsConnecting ? 'connecting…' : 'not connected'}`) +
            (rehearsal ? ' · rehearsal' : obsNoteText ? ` · ${obsNoteText}` : ''));
    };
    // ----- the race index: YouTube chapters for the OBS recording, saved to Downloads when OBS stops -----
    let lastMe = null;
    const raceIndex = (() => {
        try { return RaceIndex.from(JSON.parse(localStorage.getItem(RACE_INDEX_KEY) || 'null')); } catch (e) { return new RaceIndex(); }
    })();
    const keepIndex = () => {
        try {
            raceIndex.startMs == null ? localStorage.removeItem(RACE_INDEX_KEY) : localStorage.setItem(RACE_INDEX_KEY, JSON.stringify(raceIndex));
        } catch (e) { /* no storage: lost on a reopen only */ }
    };
    raceIndex.onAdd = title => {
        keepIndex();
        if (obs && obs.connected) obs.chapter(title).catch(() => {});   // OBS 30.2+ Hybrid MP4 only; elsewhere ignored
    };
    const saveIndex = () => {
        const text = raceIndex.text(), startMs = raceIndex.startMs;
        raceIndex.log.reset();
        keepIndex();
        if (!text) return;
        const name = `ds-video-${stamp(startMs)}-youtube-chapters.txt`;
        download(new Blob([text + '\n'], {type: 'text/plain'}), name);
        obsNote(`race index saved: ${name} (paste it into the YouTube description)`);
    };
    const videoChange = change => {
        if (change && rec) rec.video(Date.now(), change);
        if (change && change.kind === 'record') {
            if (change.event === 'start') {
                if (raceIndex.startMs != null && Math.abs(raceIndex.startMs - change.startMs) >= 2000) saveIndex();   // an old video's
                raceIndex.videoStart(change.startMs, lastMe);
                keepIndex();
            } else {
                saveIndex();
            }
        }
        showObs();
    };
    const obsConnect = async () => {
        if (!Common.settingsStore.get('obsEnabled') || obsConnecting || (obs && obs.connected)) return;
        obsConnecting = true;
        showObs();
        const c = new ObsClient({url: Common.settingsStore.get('obsUrl') || 'ws://127.0.0.1:4455',
                                 password: Common.settingsStore.get('obsPassword') || ''});
        c.on('RecordStateChanged', d => {
            // stopped (by us or by hand): nothing left to stop (not on STARTING, which is outputActive false too)
            if (d && d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') obsStarted.set(false);
            videoChange(clock.state('record', obsActive(d), Date.now()));
        });
        c.on('StreamStateChanged', d => videoChange(clock.state('stream', obsActive(d), Date.now())));
        c.onClose = () => {
            if (obs === c) obs = null;
            showObs();
        };
        try {
            await c.connect();
            obs = c;
            // already recording / streaming: it started outputDuration ago
            for (const [kind, get] of [['record', () => c.recordStatus()], ['stream', () => c.streamStatus()]]) {
                const st = await get().catch(() => null);
                if (st) videoChange(clock.state(kind, obsActive(st), Date.now(), st.outputDuration));
            }
            if (clock.starts.record == null) obsStarted.set(false);   // not recording: nothing of ours to stop
            if (clock.starts.record == null && raceIndex.startMs != null) saveIndex();   // it stopped while this window was closed
        } catch (e) {
            console.warn('OBS', e.message || e);   // fails soft: OBS missing or closed never breaks a ride
        }
        obsConnecting = false;
        showObs();
    };
    // the OBS settings changed: drop the link (if any) and connect with the new ones
    const obsReconnect = () => {
        const c = obs;
        obs = null;
        if (c) try { c.close(); } catch (e) { /* already closed */ }
        obsConnect();
    };
    // what happened with OBS, for the settings window (its Rehearse button) and this window's OBS line
    let obsNoteText = '';
    const obsNote = text => {
        obsNoteText = text;
        try {
            localStorage.setItem(OBS_STATUS_KEY, JSON.stringify({text: `${new Date().toLocaleTimeString()}: ${text}`, rehearsing: !!rehearsal}));
        } catch (e) { /* storage blocked: shown here only */ }
        showObs();
    };
    // The title card: point our scene at this race (or the rehearsal), switch to it; returns the scene to go back to
    const startTitle = async ({rehearsing = false} = {}) => {
        try {
            const base = await Common.rpc.getWebServerURL();
            if (!base) throw new Error("Sauce's web server is off (Sauce settings)");
            const ev = rehearsing ? null : await Promise.race([evInfo.ready, new Promise(r => setTimeout(() => r(null), 3000))]);
            const cardId = rehearsing ? rehearsal && rehearsal.cardId : raceCards.card && raceCards.card.id;
            const query = titleQuery({cardId, eventName: rehearsing ? 'Rehearsal' : ev && ev.eventName, subgroup: ev && ev.subgroup,
                                      startMs: rehearsing ? Date.now() : ev && ev.startMs, rider: myName,
                                      plan: cardId ? Common.settingsStore.get(cardPlanKey(cardId)) || {} : {}});
            await prepareTitle(obs, `${base}${DS_TITLE.path}?${query}`, DS_TITLE);
            return await showTitle(obs, DS_TITLE);
        } catch (e) {
            obsNote(`title card skipped: ${e.message || e}`);
            return null;
        }
    };
    const titleBack = {
        set: v => { try { v ? localStorage.setItem(TITLE_BACK_KEY, JSON.stringify(v)) : localStorage.removeItem(TITLE_BACK_KEY); } catch (e) { /* none */ } },
        get: () => { try { return JSON.parse(localStorage.getItem(TITLE_BACK_KEY) || 'null'); } catch (e) { return null; } },
    };
    // OBS recording with the title card first (if set); we started it, so we stop it
    const obsStartWithTitle = async ({rehearsing = false} = {}) => {
        const titleS = Math.max(0, Number(Common.settingsStore.get('obsTitleS')) || 0);
        const back = titleS > 0 ? await startTitle({rehearsing}) : null;
        if (back) titleBack.set({scene: back, until: Date.now() + titleS * 1000});
        try {
            await obs.startRecord();
            obsStarted.set(true);
        } catch (e) {
            obsNote(`OBS would not start recording: ${e.message || e}`);
        }
        if (back) {
            const o = obs;
            setTimeout(() => {
                titleBack.set(null);
                if (o && o.connected) hideTitle(o, back, DS_TITLE).catch(e => console.warn('title card', e));
            }, titleS * 1000);
        }
    };
    // a window closed while the title was up: back to your scene once its time is over (unless you moved on yourself)
    const titleRescue = async () => {
        const tb = titleBack.get();
        if (!tb || !(obs && obs.connected) || Date.now() < tb.until) return;
        titleBack.set(null);
        await hideTitle(obs, tb.scene, DS_TITLE).catch(e => console.warn('title card', e));
    };
    obsConnect().then(titleRescue);
    setInterval(() => { obsConnect().then(titleRescue); showObs(); }, OBS_RETRY_MS);

    // ----- recording (capture format) -----
    const store = idbStore(CAPTURE_STORE);
    const auto = new AutoRecord();
    // which events were recorded and which you finished, kept across a window reopen (auto-record.mjs state())
    const AUTO_STATE_KEY = 'director-sportif-auto-record';
    try { auto.restore(JSON.parse(localStorage.getItem(AUTO_STATE_KEY) || 'null')); } catch (e) { /* none kept */ }
    let autoSaved = null;
    const autoSave = () => {
        try {
            const st = JSON.stringify(auto.state());
            if (st !== autoSaved) localStorage.setItem(AUTO_STATE_KEY, autoSaved = st);
        } catch (e) { /* storage blocked: this window only */ }
    };
    const recBtn = content.querySelector('button.rec');
    const markBtn = content.querySelector('button.mark');
    const recState = content.querySelector('.rec-state');
    const showRec = () => {
        recBtn.textContent = rec ? 'Stop' : 'Record';
        recBtn.classList.toggle('on', !!rec);
        markBtn.disabled = !rec;
        setText(recState, rec ? `recording ${Math.round((Date.now() - rec.startedAt) / 60000)} min` :
            saving ? 'saving…' : Common.settingsStore.get('recordAlways') ? `records all the time (${auto.why(false, Date.now())})` :
            Common.settingsStore.get('autoRecordEvents') ? `records every event (${auto.why(false, Date.now())})` : 'not recording');
    };
    const startRec = async ({rehearsing = false} = {}) => {
        if (rec) return;
        rec = new CaptureRecorder({meta: {app: 'director-sportif', version: DS_VERSION, routeId, routeName, rehearsal: rehearsing || undefined}});
        recSg = null;
        cp = new Checkpoint(store, {name: `ds-${rehearsing ? 'rehearsal' : 'capture'}-${stamp(rec.startedAt)}`, rec, release: true});
        await cp.begin();
        // the video clocks as they stand (OBS already recording / streaming)
        for (const kind of ['record', 'stream']) {
            if (clock.starts[kind] != null) rec.video(Date.now(), {kind, event: 'start', startMs: clock.starts[kind]});
        }
        // record OBS with the race (only stopped later if we started it): only when you're in an event (the user,
        // 2026-10-19: a Record pressed in the warm-up free ride started OBS too), and not one you've finished (2026-10-24:
        // a recording 2 min after the finish, still in the event, started OBS again)
        const raceOn = mySg && !auto.hasEnded(mySg);
        if ((rehearsing || (Common.settingsStore.get('obsRecordWithRace') && raceOn)) && obs && obs.connected && clock.starts.record == null) {
            obsStartWithTitle({rehearsing}).catch(e => console.warn('OBS record', e));
        }
        flushTimer = setInterval(() => cp && cp.flush().catch(e => console.warn('capture checkpoint', e)), CHECKPOINT_S * 1000);
        showRec();
    };
    const stopRec = async () => {
        if (!rec) return;
        // your result, while the recording is still open (a race left early or stopped by hand: no place); a second
        // Stop while it's asked stops at once
        const sg = recSg, into = rec;
        recSg = null;
        stopping = into;
        if (sg && lastMe && lastMe.athleteId != null) {
            const res = await raceResult(sg, lastMe.athleteId).catch(e => console.warn('race result', e));
            if (res && rec === into) into.event(Date.now(), res);
        }
        if (rec !== into) return;
        if (obsStarted.get() && obs && obs.connected) {
            obs.stopRecord().then(() => obsStarted.set(false)).catch(e => console.warn('OBS stop', e));
        }
        const c = cp;
        clearInterval(flushTimer);
        rec = null;
        cp = null;
        saving = true;
        showRec();
        try {
            await c.flush();
            download(await c.blob(), `${c.name}.ndjson.gz`);
            await c.discard();
        } catch (e) {
            console.error('capture save failed: kept for next time', e);   // left in the store: saved on the next open
        }
        saving = false;
        showRec();
    };
    recBtn.addEventListener('click', () => (rehearsal ? rehearse() : rec ? stopRec() : startRec()).catch(e => console.error('record', e)));
    // ----- rehearsal: the title card, OBS start / stop and a short recording, with no race (settings ▸ OBS ▸ Rehearse) -----
    const endRehearsal = async text => {
        if (!rehearsal) return;
        clearTimeout(rehearsal.timer);
        for (const t of rehearsal.moments || []) clearTimeout(t);
        rehearsal = null;
        await stopRec();
        obsNote(text);
    };
    async function rehearse({cardId = null} = {}) {
        if (rehearsal) return endRehearsal('rehearsal cancelled: OBS stopped, the recording saved');
        if (mySg) return obsNote('you are in an event: no rehearsal now');
        if (rec) return obsNote('already recording: stop it first, then rehearse');
        if (!Common.settingsStore.get('obsEnabled')) return obsNote('turn on "Connect to OBS" first');
        if (!(obs && obs.connected)) await obsConnect();
        if (!(obs && obs.connected)) return obsNote('OBS is not connected: OBS open? WebSocket server on? password right?');
        const st = await obs.recordStatus().catch(() => null);
        if (st && st.outputActive) return obsNote('OBS is already recording: stop it first, then rehearse');
        const titleS = Math.max(0, Number(Common.settingsStore.get('obsTitleS')) || 0);
        rehearsal = {cardId};
        obsNote(`rehearsing: ${titleS ? `${titleS} s of title card, then ` : ''}${REHEARSAL_S} s of recording`);
        await startRec({rehearsing: true});
        // the race index gets the fake race's moments (generic ones), so the saved chapters can be checked too
        const plan = rehearsalPlan({nowMs: Date.now() + titleS * 1000, leadS: 0});
        rehearsal.moments = plan.moments.map(m => setTimeout(() => raceIndex.add(Date.now(), `${m.title} (rehearsal)`, m.priority),
                                                           Math.max(0, m.ms - Date.now())));
        rehearsal.timer = setTimeout(() => endRehearsal('rehearsal done: OBS stopped, the recording saved to Downloads')
            .catch(e => console.error('rehearsal', e)), (titleS + REHEARSAL_S) * 1000);
    }
    window.addEventListener('storage', ev => {
        if (ev.key !== REHEARSE_KEY || !ev.newValue) return;
        let req = {};
        try { req = JSON.parse(ev.newValue) || {}; } catch (e) { /* a bad request: rehearse without a card */ }
        rehearse(req).catch(e => obsNote(`rehearsal failed: ${e.message || e}`));
    });
    markBtn.addEventListener('click', () => {
        if (!rec) return;
        rec.mark(Date.now(), 'weird');
        markBtn.classList.remove('flash');
        void markBtn.offsetWidth;
        markBtn.classList.add('flash');
    });
    // a recording left by a crash or a closed window: saved now (no keyboard mid-ride: no question asked)
    leftovers(store).then(async list => {
        for (const r of list) {
            download(await recoveredBlob(store, r.id), `${r.name}-recovered.ndjson.gz`);
            await store.remove(r.id);
        }
    }).catch(e => console.warn('capture leftovers', e));
    // Start / stop by itself: on this timer AND on every tick of yours (a hidden window's timers slow to about one a
    // minute; the data keeps coming, subscribed persistent below). Busy while a start or stop is under way.
    let autoBusy = false, autoAt = 0;
    const autoCheck = () => {
        if (autoBusy || Date.now() - autoAt < 1000) return;
        autoAt = Date.now();
        auto.events = !!Common.settingsStore.get('autoRecordEvents');
        auto.always = !!Common.settingsStore.get('recordAlways');
        if (auto.events || auto.always || auto.owned != null) {   // owned: turned off mid-recording -> its stop
            const what = auto.check(Date.now(), !!rec);
            if (what === 'start') {
                autoBusy = true;
                startRec().then(() => { auto.started(); autoSave(); }).catch(e => console.error('auto record', e)).finally(() => { autoBusy = false; });
            } else if (what === 'stop') {
                autoBusy = true;
                stopRec().then(() => auto.stopped()).catch(e => console.error('auto record', e)).finally(() => { autoBusy = false; });
            }
        }
        autoSave();
        showRec();
    };
    setInterval(autoCheck, 5000);
    showRec();
    setInterval(() => {
        if (Date.now() - lastTick > STALE_MS) {
            setText(el.state, channel ? 'waiting for Zwift data' : 'running, but this Sauce can\'t pass data to the Grid');
            setText(el.word, '—');
        }
    }, 1000);
    Common.subscribe('nearby', list => {
        const r = engine.update(list);
        if (!r) {
            return;
        }
        lastTick = Date.now();
        bikeCheck.update(r.me);
        const data = buildData(r);
        data.call = engineCall(data, r.ds);
        // the recording: the list as Sauce gave it (capture.mjs keeps only what docs/CAPTURE.md says) + the call
        if (rec) rec.tick(lastTick, list, data.self ? data.call : null);
        if (r.me.self) {
            lastMe = r.me;
            raceIndex.tick(lastTick, r.me, {card: raceCards.card, jumped: engine.sprintCoach.jumped});
            mySg = r.me.state.eventSubgroupId || null;
            myName = (r.me.athlete && r.me.athlete.sanitizedFullname) || myName;
            noteEvent(mySg);
            // your event's name into the recording, once per event (the report's title and summary)
            if (rec && rec !== stopping && mySg && recSg !== mySg) {
                const sg = recSg = mySg, into = rec;
                evInfo.ready.then(v => {
                    if (rec === into) into.event(Date.now(), {sg, name: (v && v.eventName) || null, subgroup: (v && v.subgroup) || null,
                                                              type: (v && v.eventType) || null});
                });
            }
            if (mySg && rehearsal) endRehearsal('rehearsal ended: you joined an event').catch(e => console.error('rehearsal', e));
            auto.tick(lastTick, {sg: r.me.state.eventSubgroupId,
                                 finished: r.me.remainingType === 'event' && Number.isFinite(r.me.remaining) && r.me.remaining <= 0,
                                 left: r.me.remainingType === 'event' ? r.me.remaining : null,
                                 start: eventStart(mySg), moving: Number.isFinite(r.me.state.eventDistance) && r.me.state.eventDistance > 0});
            autoCheck();
        }
        if (channel) {
            try {
                channel.postMessage({type: 'tick', data});
            } catch (e) { /* a closed channel: the calls still work */ }
        }
        // the status panel
        const s = r.me.state;
        if (s.routeId !== routeId) {
            routeId = s.routeId;
            routeName = null;
            if (routeId != null) {
                Promise.resolve().then(() => Common.getRoute(routeId, {prelude: 'leadin'}))
                    .then(x => { if (routeId === s.routeId) routeName = x && x.name; })
                    .catch(e => console.warn('route name', e));
            }
        }
        const said = allWords(data, wordsHold);
        setText(el.word, said.text || '—');
        el.word.classList.toggle('warn', said.level === 'warn');
        el.word.classList.toggle('alarm', said.level === 'alarm');
        setText(el.state, `${data.self ? 'you' : 'watching'} · group ${data.meters.group.value ?? '-'} · ` +
            `${r.ds.ahead === 'route' ? 'route ahead' : r.ds.ahead === 'riders' ? 'road from the riders' : 'no road ahead'}`);
        const card = raceCards.card;
        setText(el.route, `${routeName || (routeId != null ? 'route…' : 'no route')}` +
            `${card ? ` · card: ${card.name}` : s.eventSubgroupId ? ' · no race card' : ''}`);
        if (Date.now() - fitCheckAt > 1000 && Common.settingsStore.get('fitWindow') !== false) {
            fitCheckAt = Date.now();
            fitter.fit({growOnly: true});
        }
        // calls sound for you only, not for a rider you are watching (docs/DS-DATA.md)
        const call = data.self ? data.call : null;
        const how = call ? delivery[call.id] : null;
        const sound = announcer.offer(call, how);
        if (sound && sound.say) {
            speaker.utter(sound.say, {chime: !!sound.tones, tones: sound.tones || undefined});
        } else if (sound && sound.tones) {
            speaker.ding(sound.tones);
        }
    }, {persistent: true});   // Sauce pauses a hidden window's subscriptions: with auto-hide, the pen (standing still) hid
    // the window and nothing ran, no auto-record, no OBS, until it showed again (the user, 2026-10-19; Data Tap v0.53.2)
}

/* ----- settings window ----- */

/*
 * The race card section of the settings window: pick a card, then your plan for each item (contest / position / skip
 * a scored segment, use / keep your power-up at an arch that gives one, a note for anything). Saved per card; the
 * meter window uses the card for the route you're racing by itself.
 */
async function initRaceCardEditor() {
    const sel = document.querySelector('#race-card select.card');
    const list = document.querySelector('#race-card .card-items');
    const info = document.querySelector('#race-card .card-info');
    if (!sel || !list) return;
    let shipped = [];
    try {
        shipped = await loadIndex(fetchJSON);
    } catch (e) {
        info.textContent = 'The shipped race cards could not be read.';
    }
    let entries = [];
    const fill = (want = null) => {
        entries = cardEntries(shipped, importedCards());
        sel.innerHTML = entries.map(c => `<option value="${Common.sanitizeAttr(c.id)}">${Common.sanitize(c.name || c.id)}` +
            `${c.imported ? ' (imported)' : ''}</option>`).join('');
        // the card you picked last (the user, 2026-10-19: it opened on the first card every time; Rehearse uses it)
        let picked = want;
        if (!picked) try { picked = localStorage.getItem(CARD_PICKED_KEY); } catch (e) { /* storage blocked: the first card */ }
        if (picked && entries.some(c => c.id === picked)) sel.value = picked;
    };
    fill();
    // import / remove (race-cards-live.mjs importCard): a card file from caffecter.com's race card maker or by hand
    const file = document.querySelector('#race-card .card-import-file');
    const removeBtn = document.querySelector('#race-card .card-remove');
    const importStatus = document.querySelector('#race-card .card-import-status');
    const pick = id => {
        try { localStorage.setItem(CARD_PICKED_KEY, id); } catch (e) { /* not kept */ }
    };
    document.querySelector('#race-card .card-import-button')?.addEventListener('click', () => file && file.click());
    file?.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        try {
            const [next, msg] = importCard(await f.text(), importedCards());
            saveImportedCards(next);
            const id = next.at(-1).id;
            pick(id);
            fill(id);
            importStatus.textContent = msg;
            await show();
        } catch (e) {
            importStatus.textContent = String(e.message || e);
        }
    });
    removeBtn?.addEventListener('click', async () => {
        const id = sel.value;
        saveImportedCards(importedCards().filter(c => c.id !== id));
        Common.settingsStore.set(cardPlanKey(id), null);
        importStatus.textContent = 'removed';
        fill();
        await show();
    });
    const show = async () => {
        const entry = entries.find(c => c.id === sel.value);
        list.replaceChildren();
        if (removeBtn) removeBtn.hidden = !(entry && entry.imported);
        if (!entry) {
            info.textContent = 'No race cards yet: import one.';
            return;
        }
        let card;
        try {
            card = await loadEntry(fetchJSON, entry);
        } catch (e) {
            info.textContent = String(e.message || e);
            return;
        }
        const plan = Common.settingsStore.get(cardPlanKey(card.id)) || {};
        const save = () => Common.settingsStore.set(cardPlanKey(card.id), plan);
        info.textContent = `${card.format ? `${card.format} race · ` : ''}${card.route || ''}${card.distanceKm ? ` · ${card.distanceKm} km` : ''}` +
            '. It speaks only on its own route, in an event. Your plan is saved on this computer.';
        for (const it of card.items) {
            const key = itemKey(it);
            const p = plan[key] || (plan[key] = {});
            const row = document.createElement('div');
            row.className = 'card-row';
            const gives = it.gives && it.gives !== 'XP' ? it.gives : null;
            const what = document.createElement('div');
            what.className = 'what';
            what.textContent = `${it.km == null ? '?' : it.km} km · ${it.name}${it.scored ? ' · points' : ''}` +
                `${gives ? ` · arch: ${gives === 'RANDOM' ? 'random power-up' : gives}` : ''}`;
            row.append(what);
            const pick = (values, current, title, onChange) => {
                const s = document.createElement('select');
                s.title = title;
                s.innerHTML = values.map(v => `<option value="${v}"${v === current ? ' selected' : ''}>${v}</option>`).join('');
                s.addEventListener('change', () => { onChange(s.value); save(); });
                row.append(s);
            };
            if (it.scored && it.kind !== 'finish') pick(PLANS_SEGMENT, planFor(it, plan), 'Your plan for this segment', v => (p.plan = v));
            if (gives) pick(PLANS_ARCH, powerFor(it, plan), 'The power-up you hold at this arch', v => (p.power = v));
            const note = document.createElement('input');
            note.type = 'text';
            note.placeholder = 'note (said shortly before)';
            note.value = p.note || '';
            note.addEventListener('change', () => { p.note = note.value.trim() || undefined; save(); });
            row.append(note);
            list.append(row);
        }
    };
    sel.addEventListener('change', () => {
        try { localStorage.setItem(CARD_PICKED_KEY, sel.value); } catch (e) { /* not kept */ }
        show();
    });
    await show();
}

/* The call delivery grid: one row per call type, a checkbox per way (bound by name like any setting). */
function renderDeliveryGrid() {
    const el = document.querySelector('.call-delivery');
    if (!el) return;
    el.innerHTML = deliveryGridHTML(Common.sanitize, Common.sanitizeAttr);
}

export async function settingsMain() {
    Common.initInteractionListeners();
    applyDefaults();
    renderDeliveryGrid();
    document.querySelector('select[name="bike"]').innerHTML = options(BIKES, DEFAULT_BIKE);
    document.querySelector('select[name="wheels"]').innerHTML = options(WHEELS, DEFAULT_WHEELS);
    // one small form per tab (Sauce's own settings window does the same); each binds its fields to the settings
    for (const id of ['you', 'calls', 'record', 'obs', 'look']) {
        await Common.initSettingsForm(`form#${id}`)();
    }
    initRaceCardEditor().catch(e => console.warn('race card editor', e));
    // Rehearse (OBS tab): asks the Director Sportif window (which holds the OBS link) to run one; its answer comes back
    const rehBtn = document.querySelector('button.obs-rehearse');
    const rehStatus = document.querySelector('.obs-rehearse-status');
    const showObsStatus = () => {
        let st = null;
        try { st = JSON.parse(localStorage.getItem(OBS_STATUS_KEY) || 'null'); } catch (e) { /* none */ }
        rehStatus.textContent = st ? st.text : '';
        rehBtn.textContent = st && st.rehearsing ? 'Cancel rehearsal' : 'Rehearse';
    };
    rehBtn.addEventListener('click', () => {
        const card = document.querySelector('#race-card select.card');
        try {
            localStorage.setItem(REHEARSE_KEY, JSON.stringify({at: Date.now(), cardId: card ? card.value || null : null}));
            rehStatus.textContent = 'asked the Director Sportif window (keep it open)…';
        } catch (e) {
            rehStatus.textContent = 'could not reach the Director Sportif window';
        }
    });
    showObsStatus();
    window.addEventListener('storage', ev => {
        if (ev.key === OBS_STATUS_KEY) showObsStatus();
    });
}
