/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The data object the Director Sportif publishes (docs/DS-DATA.md, v1): one per tick, the only thing a display
 * reads. Values are numbers (metric), states are short codes, words come from VOCAB; no sentences, numbers or names
 * in a word. Pure (no Sauce imports), so it is tested headless.
 *
 *   {v, ts, self, meters: {<key>: {value, state, level, ...extra}}, basics: {...}, call: {...} | null}
 */

import {teamHrWord} from './team-hr.mjs';
import {rangeLevel, DEFAULT_RANGES} from './tiles.mjs';

export const DATA_VERSION = 1;
export const CHANNEL = 'director-sportif/v1';

/*
 * Gap is shown wheel to wheel, as riders think of it (the user, 2026-10-30: "6 inches in a tight pack"); the engine's
 * gaps stay center to center. Zwift's draft knows the bike's length (research/2026-10-30/draft-overlap.mjs): a
 * follower keeps all of it down to 1.5 m center to center, 88% at 1–1.25 m, 31% at 0–0.25 m. Below 0: overlapping.
 */
export const BIKE_LENGTH_M = 1.5;
export const wheelGap = centerM => (Number.isFinite(centerM) ? centerM - BIKE_LENGTH_M : null);

/*
 * Every meter's states: the word a display shows (active words for advice; '' = nothing to show) and a one-line
 * help for tooltips (the long explanation, no numbers). The common states (alone, settling, coasting, warming, draftless, none)
 * show no word.
 */
const COMMON = {
    alone: {word: '', help: 'Not in a group.'},
    settling: {word: '', help: 'You just teleported: power and speed don\'t match for a few seconds.'},
    coasting: {word: '', help: 'Coasting: the draft only adds speed, it saves no pedaling watts.'},
    warming: {word: '', help: 'Filling the averaging window.'},
    draftless: {word: '', help: 'You get no draft (a TT bike in a group, or a time trial): the pack meters and their calls are off.'},
    'no-map': {word: 'no map', help: 'Sauce has no map for this road yet (a new road): gaps are unknown until you have ridden a few seconds on it, then measured from where Zwift puts you along the road.'},
    none: {word: '', help: ''},
};

export const VOCAB = {
    position: {
        ...COMMON,
        good: {word: 'stay', help: 'Good spot: within a few watts of the best spot at your speed.'},
        'sit-in': {word: 'sit in', help: 'You are on the front: sitting in behind a wheel saves this much.'},
        shatter: {word: 'shattering', help: 'The group is breaking up ahead of you: do what you can (hold the front part, or the group you can). No advice about your gap meanwhile.'},
        gapping: {word: 'gap opening', help: 'A hole is opening in front of your wheel (or the next one): close it or go round, or you are gapped.'},
        'too-close': {word: 'back off', help: 'Too close to the wheel: ease back to the best gap (or drift to the back of the bunch).'},
        boxed: {word: 'drift back', help: 'Boxed in close to the wheel: drift to the back, where there is room.'},
        'close-up': {word: 'close up', help: 'Too far off the wheel: close up to the best gap.'},
        'find-wheel': {word: 'find a wheel', help: 'Get on a wheel at the best gap.'},
        unsteady: {word: 'hold a wheel', help: 'Less draft than your gap should give: the wheel is moving about, or you are off its line. Hold one wheel, in line.'},
        'no-draft': {word: 'change wheel', help: 'This wheel gives no draft (a hand cycle or recumbent?): find another.'},
    },
    holding: {
        ...COMMON,
        hold: {word: 'hold', help: 'You spend what keeping your place needs.'},
        easy: {word: 'easy', help: 'You push more than keeping your place needs: ease off.'},
        blocked: {word: 'ease off', help: 'The extra watts go into the wheel in front: ease off or steer to space.'},
        'moving-up': {word: 'moving up', help: 'Moving up through the group: the extra watts are the price of the move.'},
        drifting: {word: 'drifting', help: 'You spend less than keeping your place needs: you drift back.'},
    },
    pack: {
        ...COMMON,
        pair: {word: '', help: 'With one rider: no pack cost.'},
        front: {word: 'front', help: 'Front of the group.'},
        room: {word: 'room', help: 'Room around you, at the best gap: the cheapest spot.'},
        tight: {word: 'tight', help: 'Close to the wheel: it costs more than the draft says.'},
        crowded: {word: 'crowded', help: 'Several riders close ahead: it costs more than the draft says.'},
        boxed: {word: 'boxed', help: 'Boxed in: riders close behind and beside you.'},
        group: {word: '', help: 'In the group.'},
    },
    blocked: {
        ...COMMON,
        clear: {word: '', help: 'Not blocked.'},
        blocked: {word: 'ease off', help: 'Pushing into the wheel: the watts vanish. It happens anywhere within 2 m of ' +
                 'their wheel, overlapped or not, and nearly stops further back. Ease off to 2 m+ or steer to space.'},
        'blocked-left': {word: 'drop back', help: 'Stuck alongside a rider on your left: drop back, pass where there is room.'},
        'blocked-right': {word: 'drop back', help: 'Stuck alongside a rider on your right: drop back, pass where there is room.'},
    },
    passing: {
        ...COMMON,
        'too-slow': {word: 'go harder', help: 'Closing on a rider too slowly gets you held: go with 5+ km/h more, or wait.'},
        'go-wide': {word: 'go wide', help: 'In line with the rider you are closing on: go wide (1.5 m+) or with 5+ km/h more.'},
        'drop-back': {word: 'drop back', help: 'Glued to their wheel: pulling out here gets you held. Drop back to 1.5–3.5 m between wheels, pull out to the edge, come by fast.'},
        'rider-left': {word: 'block left', help: 'In a race, a rider creeping up on your left: ease over into their way. Being held costs them far more than you.'},
        'rider-right': {word: 'block right', help: 'In a race, a rider creeping up on your right: ease over into their way. Being held costs them far more than you.'},
    },
    gap: {
        ...COMMON,
        wheel: {word: '', help: 'From your front wheel to the back wheel in line in front of you (below 0: overlapping).'},
        beside: {word: 'beside', help: 'No rider in line: the nearest is beside you.'},
        'no-wheel': {word: '', help: 'No wheel within 25 m.'},
        'no-draft': {word: 'no draft', help: 'This wheel gives no draft (a hand cycle or recumbent?).'},
    },
    side: {
        ...COMMON,
        inline: {word: '', help: 'Left or right of the wheel in front.'},
        beside: {word: 'beside', help: 'Left or right of the nearest rider beside you (none in line).'},
        'no-wheel': {word: '', help: 'No wheel within 25 m.'},
    },
    tuck: {
        ...COMMON,
        build: {word: '', help: 'Speed still needed to supertuck (58 km/h on −3% or steeper, out of the draft).'},
        soon: {word: 'supertuck', help: 'You reach supertuck speed in that many seconds at the speed you are gaining: ' +
               'keep pedaling until then, then coast.'},
        stop: {word: 'coast', help: 'Fast enough to supertuck: stop pedaling. In a race the tuck is about as aero as the AERO power-up.'},
        rest: {word: '', help: 'Fast enough to supertuck, but not in a race (or not known yet): no call, coast if you like.'},
        tuck: {word: 'tuck', help: 'In the supertuck.'},
        draft: {word: 'in draft', help: 'No supertuck in the draft.'},
        frame: {word: 'no tuck', help: 'No supertuck on a TT or MTB frame.'},
    },
    group: {...COMMON},
    surface: {
        ...COMMON,
        pavement: {word: '', help: 'Pavement.'},
        wood: {word: 'wood', help: 'Wood: it rolls slower than pavement on road tyres.'},
        brick: {word: 'brick', help: 'Brick: it rolls slower than pavement on road tyres.'},
        cobbles: {word: 'cobbles', help: 'Cobbles: they roll slower than pavement on road tyres.'},
        dirt: {word: 'dirt', help: 'Dirt: road tyres pay a lot here; a gravel bike is faster.'},
        gravel: {word: 'gravel', help: 'Gravel: road tyres pay a lot here; a gravel bike is faster.'},
        grass: {word: 'grass', help: 'Grass: the slowest surface.'},
        sand: {word: 'sand', help: 'Sand (rolls like pavement in Zwift).'},
        snow: {word: 'ice', help: 'Ice / snow.'},
    },
    burrito: {
        ...COMMON,
        ahead: {word: '', help: 'Riders ahead of you in your race who have not fired their burrito yet (everyone got one): ' +
                'each can take your draft for 20 s. Near the front, fewer are ahead of you.'},
        cone: {word: 'move over', help: 'A burrito fired just ahead of you: no draft for 20 s in a short wedge behind it ' +
               '(up to 7 m behind their wheel, a quarter of that either side). Move a lane over, or sit 7.5 m+ back.'},
        done: {word: 'done', help: 'Nearly everyone has fired their burrito: safe to slide back into the bunch.'},
        clear: {word: '', help: 'No burrito active near you.'},
    },
    frc: {
        ...COMMON,
        ok: {word: '', help: 'Your reserve above FTP (FRC), from your power: it drains above FTP, refills below.'},
        low: {word: 'low', help: 'Under 30% of your reserve left: save it for what matters.'},
        empty: {word: 'empty', help: 'Under 10% left: above FTP you have only seconds.'},
    },
    demand: {
        ...COMMON,
        ok: {word: '', help: 'The power the ideal spot needs to stay with your group over 30 s: what the pack asks of anyone.'},
    },
    cda: {
        ...COMMON,
        model: {word: '', help: 'Your bike type × your size from the Zwift profile.'},
        yours: {word: '', help: 'The CdA you entered in settings.'},
        guessed: {word: '', help: 'Your bike type × a guessed size (height or weight hidden in your profile).'},
    },
};

/*
 * The director's calls (from the Data Tap, docs/DS-DISPLAY.md step 4): their words per state. Seconds ride beside
 * the word (`in`) only where the time is the point ("climb in 90"); "move up" means now, not in 60 s.
 */
export const CALL_WORDS = {
    moveUp: {prep: 'climb', move: 'move up', hold: 'hold spot', late: 'stay in line'},
    sprint: {position: 'top ten', good: 'good spot', 'window-prep': 'jump', windup: 'get a wheel', last: 'last wheel, be ready', 'last-go': 'jump now',
             'keep-going': 'keep going', ease: 'ease off', 'ease-ftp': 'ease to FTP', window: 'you can go', 'take-wheel': 'wheel, jump', 'take-wheel-light': 'wheel, jump light', 'take-wheel-medium': 'wheel, jump medium', 'take-wheel-hard': 'wheel, jump hard', 'shake-left': 'drift left', 'shake-right': 'drift right', closer: 'dig in'},
    nudge: {wheel: 'ease off', middle: 'use edge', front: 'sit in', line: 'get in line', crowd: 'give room'},
};

/*
 * Power-ups by the names Zwift shows (Sauce's ids -> the word), and when each is best fired at the finish
 * (engine/director.mjs SprintCoach: AERO on your jump or 15 s to go, the van 40 s, the burrito 20 s from the front,
 * the ghost just before 400 m, the arrows and the feather on your jump). Advice only: never fired for you.
 * PROVISIONAL (the user, 2026-10-16): "after I jump my hands are busy": a call on your jump comes too late (the
 * recorded presses came 1–10 s into the sprint). To come: "AERO, go go go" your reaction + press time BEFORE the
 * launch, the launch from the pack getting jumpy, the race card or your learned launch distance (docs/PLAN.md §6).
 */
export const POWERUP_NAMES = {AERO: 'AERO', DRAFTBOOST: 'VAN', NINJA: 'GHOST', UNDRAFTABLE: 'BURRITO', BOOST: 'ARROWS',
                              LIGHTNESS: 'FEATHER'};
const FIRE_AT_S = {AERO: 15, DRAFTBOOST: 40, UNDRAFTABLE: 20};
const GHOST_AT_M = 400;

export const SURFACE_CALL_S = 45;
export const FEATHER_FIRE_PRIORITY = 86.5;   // over the finish's "jump in N" (86), under "you can go" (87): your jump fires it anyway

/* Seconds for a call: to 5 s above 20 s, whole seconds below (docs/DS-DATA.md). */
export function roundIn(secs) {
    if (!Number.isFinite(secs) || secs < 0) return null;
    return secs > 20 ? Math.round(secs / 5) * 5 : Math.round(secs);
}

/* The director's call candidates from the engine's reading, in the data object's call form. */
// the finish calls about wheels: nothing to take or shake with no draft
const WHEEL_SPRINT = new Set(['windup', 'last', 'last-go', 'take-wheel', 'take-wheel-light', 'take-wheel-medium',
                              'take-wheel-hard', 'shake-left', 'shake-right', 'closer']);

export function directorCalls(ds) {
    const out = [];
    const draftless = !!(ds && ds.draftless);   // no draft at all: no move up, habits or wheel calls (v0.40.0)
    const m = !draftless && ds && ds.moveUp;
    if (m && CALL_WORDS.moveUp[m.state]) {
        out.push({id: 'moveUp', state: m.state, word: CALL_WORDS.moveUp[m.state],
                  in: m.state === 'prep' ? roundIn(m.secs) : null, for: null, priority: m.priority});
    }
    const c = ds && ds.card;
    if (c && c.about) {
        let word = null, inS = c.inS;
        if (c.about === 'segment') {
            word = c.plan === 'skip' ? 'skip it' : c.plan === 'position' ? 'position' : c.kind === 'kom' ? 'KOM' : 'sprint';
        } else if (c.about === 'line') {
            word = c.kind === 'kom' ? 'KOM line' : 'sprint line';
            inS = c.endS;
        } else if (c.about === 'arch') {
            word = `${c.power === 'keep' ? 'keep' : 'use'} ${POWERUP_NAMES[c.held] || c.held || 'it'}`;
        } else if (c.about === 'note') {
            word = String(c.note || '').trim() || null;   // your own words, as you wrote them
        }
        if (word) out.push({id: 'card', state: c.state, word, in: roundIn(inS), for: null, priority: c.priority});
    }
    // a rough surface: called within SURFACE_CALL_S of it (600 m ahead was ~2 min at group-ride speed: "wood in 105
    // for 10" for a bridge, 2026-10-12 replay); the Surface meter shows its cost once you're on it
    const sa = ds && ds.surfaceAhead;
    if (sa && sa.inS != null && sa.inS <= SURFACE_CALL_S && VOCAB.surface[sa.surface] && VOCAB.surface[sa.surface].word) {
        out.push({id: 'surface', state: sa.surface, word: VOCAB.surface[sa.surface].word, in: roundIn(sa.inS),
                  for: roundIn(sa.forS), priority: 20});
    }
    // burritos (burrito.mjs): one fired just ahead of you, and once they're nearly all gone
    const bu = ds && ds.burrito;
    if (bu && bu.state === 'cone') {
        out.push({id: 'burrito', state: 'cone', word: 'burrito, move over', in: null, for: null, priority: 72});
    } else if (bu && bu.state === 'done') {
        out.push({id: 'burrito', state: 'done', word: 'burritos done', in: null, for: null, priority: 30});
    }
    // a teammate with no heart rate (team-hr.mjs): said when it starts and every 2 min (some races DQ for it)
    const th = ds && ds.teamHr;
    if (th && th.say && th.names.length) {
        out.push({id: 'teamHr', state: th.state, word: teamHrWord(th), in: null, for: null, priority: th.state === 'missing' ? 74 : 30});
    }
    const pc = ds && ds.pacing;
    if (pc && (pc.state === 'steep' || pc.state === 'top')) {
        out.push({id: 'pacing', state: pc.state, word: pc.state === 'steep' ? 'steep' : 'over top', in: roundIn(pc.inS),
                  for: pc.state === 'steep' ? roundIn(pc.forS) : null, priority: 35});
    }
    // a bend: the inside open (move over: it gains ground) or you're on the outside (stay close: you'll lose ground)
    // a stretch that twists enough to steer a shorter line (engine sCurve): "cut the S in 5" (a hairpin: "cut the bend")
    const sc = ds && ds.sCurve;
    if (sc) out.push({id: 'bend', state: sc.s ? 'cut-s' : 'cut-bend', word: sc.s ? 'cut the S' : 'cut the bend',
                      in: roundIn(sc.inS), for: null, priority: 46});
    const b = ds && ds.bend;
    if (b && (b.state === 'open' || b.state === 'outside')) {
        out.push({id: 'bend', state: `${b.state}-${b.side}`, word: b.state === 'open' ? `inside ${b.side}` : 'stay close',
                  in: b.state === 'open' ? roundIn(b.inS) : null, for: null, priority: 45});   // stay close: now
    }
    // the feather you hold, for the steepest 30 s ahead. The name and the seconds, no "hold" (v0.46.1; the user,
    // 2026-10-26: "hold feather in 25 is hard to parse. Maybe just feather in 25"). "FEATHER now" outranks "jump in N"
    // (Spiral Summit 2026-10-27: the Volcano's 9% kick came 320 m out, inside the jump countdown)
    const f = ds && ds.feather;
    if (f && (f.state === 'ready' || f.state === 'fire')) {
        out.push({id: 'powerup', state: `feather-${f.state}`, word: f.state === 'fire' ? 'FEATHER now' : 'FEATHER',
                  in: f.state === 'ready' ? roundIn(f.inS) : null, for: null, priority: f.state === 'fire' ? FEATHER_FIRE_PRIORITY : 50});
    }
    const n = !draftless && ds && ds.nudge;
    if (n && CALL_WORDS.nudge[n.state]) {
        out.push({id: 'nudge', state: n.state, word: CALL_WORDS.nudge[n.state], in: null, for: null, priority: n.priority});
    }
    const sp = ds && ds.sprint;
    if (sp) {
        const toLine = Number.isFinite(sp.toLineS) ? sp.toLineS : null;
        if (CALL_WORDS.sprint[sp.state] && !(draftless && WHEEL_SPRINT.has(sp.state))) {
            // the line's seconds only 1.5 km out: inside 1 km the bunch winds up and a cruising estimate runs long
            // (Urumaze 2026-10-06: +13 s median), and "get a wheel" means now anyway ("last wheel, be ready" is timed by the engine)
            const timed = ['position', 'good'].includes(sp.state);
            // "take the wheel" is its own call type (v0.26.0: turned off without the rest of the finish); "jump in 20":
            // the seconds to the sprint window
            out.push({id: /^take-wheel/.test(sp.state) ? 'wheel' : 'sprint', state: sp.state, word: CALL_WORDS.sprint[sp.state],
                      in: sp.state === 'window-prep' ? roundIn(sp.inS) : timed ? roundIn(toLine) : null, for: null, priority: sp.priority});
        } else if (/^fire-/.test(sp.state)) {
            const name = sp.state.slice(5);   // SprintCoach's own names: AERO, VAN, GHOST, BURRITO, ARROWS
            out.push({id: 'powerup', state: `fire-${name.toLowerCase()}`, word: `${name} now`, in: null, for: null,
                      priority: sp.priority});
        } else if (sp.state === 'prep' && sp.held && POWERUP_NAMES[sp.held] && !(sp.held === 'LIGHTNESS' && f && f.state)) {
            // (a climb ahead times the feather, above: Spiral Summit 2026-10-27 said "FEATHER at jump" 1.2 km out on the
            // Volcano, and it went there; the 9% kick at 320 m was the place)
            // holding one for the finish: when to fire it (the arrows and the feather: on your jump, no seconds)
            const name = POWERUP_NAMES[sp.held];
            const at = FIRE_AT_S[sp.held];
            const inS = at != null && toLine != null ? toLine - at :
                sp.held === 'NINJA' && Number.isFinite(sp.remainingM) && toLine != null && sp.remainingM > 0 ?
                    toLine * (sp.remainingM - GHOST_AT_M) / sp.remainingM : null;
            // "AERO in 35"; with no seconds (the arrows, the feather) it goes with your jump: "FEATHER at jump"
            out.push({id: 'powerup', state: `hold-${name.toLowerCase()}`, word: roundIn(inS) != null ? name : `${name} at jump`,
                      in: roundIn(inS), for: null, priority: sp.priority});
        }
    }
    return out;
}

/* The word / help for a meter's state ('' when unknown). */
export const wordOf = (key, state) => VOCAB[key]?.[state]?.word ?? '';
export const helpOf = (key, state) => VOCAB[key]?.[state]?.help ?? '';

const WATT_METERS = new Set(['position', 'holding', 'pack', 'blocked', 'surface']);
const fin = x => (Number.isFinite(x) ? x : null);

/* One meter entry: watt meters read 0 with nothing to read, the rest null (docs/DS-DATA.md). */
function meter(key, value, state, extra = {}) {
    const v = fin(value);
    const shown = v == null && WATT_METERS.has(key) ? 0 : v;
    const [warn, alarm] = DEFAULT_RANGES[`ds-${key}`] || [null, null];
    return {value: shown, state, level: v == null ? null : rangeLevel(v, warn, alarm) || null, ...extra};
}

const DEFEND_STATE = {'on your left': 'rider-left', 'on your right': 'rider-right'};   // straight behind: no call (v0.51.0)

/*
 * The data object from one engine tick (meter-engine.mjs update -> {me, ds}). The call is added by the caller
 * (calls.mjs dsCall(data)), so it reads the same states as the meters.
 */
export function buildData({me, ds}, {now = Date.now()} = {}) {
    const s = (me && me.state) || {};
    const settling = !!ds.settling;
    const alone = !(ds.groupSize >= 2);
    // no draft at all (a TT bike, a time trial): the pack meters have nothing to say (v0.40.0)
    const draftless = !settling && !alone && !!ds.draftless;
    // a road Sauce has no map for, before its scale is learned (road-gaps.mjs): no gaps, so no pack meters (v0.50.0)
    const noMap = !settling && ds.gapSource === 'none';
    const common = settling ? 'settling' : noMap ? 'no-map' : alone ? 'alone' : draftless ? 'draftless' : null;
    const pack = x => (draftless ? null : x);

    const blockedState = common || (ds.blocked ? (ds.blockedSide ? `blocked-${ds.blockedSide}` : 'blocked') : 'clear');
    let passState = 'none';
    if (ds.passKind === 'attack') passState = ds.passAtWheel ? 'drop-back' : ds.passWide ? 'too-slow' : 'go-wide';
    else if (ds.passKind === 'defend') passState = DEFEND_STATE[ds.passWhere] || 'none';
    if (draftless) passState = 'draftless';
    const gapState = noMap ? 'no-map' : ds.noDraftWheel ? 'no-draft' : Number.isFinite(ds.gapM) ? 'wheel' : ds.beside ? 'beside' : 'no-wheel';
    const sideState = noMap ? 'no-map' : !Number.isFinite(ds.sideM) ? 'no-wheel' : ds.beside ? 'beside' : 'inline';
    const t = ds.tuck;
    // words only in a race (the user, 2026-10-30: "if the rider wants to coast, he will coast"): outside one, or not
    // known yet, the meter still reads but says nothing
    const race = !!(t && t.race === true);
    const ready = race ? 'stop' : 'rest';
    const soonS = race && t.state === 'build' && Number.isFinite(t.inS) ? roundIn(t.inS) : null;
    const tuckState = !t ? 'none' : soonS != null ? 'soon' :
        {build: 'build', ready, tucked: 'tuck', draft: 'draft', frame: 'frame'}[t.state] || 'none';
    const tuckValue = !t ? null : t.state === 'build' ? t.needKmh : t.state === 'ready' || t.state === 'tucked' ? 0 : null;
    const drag = t && t.drag && t.drag.tucked ? {
        tuck: t.drag.tucked.cda, coast: t.drag.coast ? t.drag.coast.cda : null,
        tuckS: t.drag.tucked.s, coastS: t.drag.coast ? t.drag.coast.s : null,
    } : null;

    return {
        v: DATA_VERSION,
        ts: now,
        self: !!(me && me.self),
        meters: {
            position: meter('position', pack(ds.positionW), common || ds.positionState || 'none'),
            holding: meter('holding', pack(ds.holdingW), common || ds.holdingState || 'warming'),
            pack: meter('pack', pack(ds.packW), draftless ? common : ds.packState || common || 'none'),
            blocked: meter('blocked', pack(ds.blockedW), blockedState),
            passing: meter('passing', pack(ds.passKmh) ?? (common ? null : 0), passState),
            // below 0 = overlapping wheels: no word of its own (Blocked says "ease off" when it costs; the user, 2026-10-30)
            gap: meter('gap', wheelGap(ds.gapM), gapState, {centerM: fin(ds.gapM), ...(ds.gapApprox ? {approx: true} : {})}),
            side: meter('side', ds.sideM, sideState),
            // "supertuck in 6": the word carries the seconds (a display word, no chime: the "coast" chime stays the call)
            tuck: meter('tuck', tuckValue, tuckState, {...(drag ? {drag} : {}),
                        ...(soonS != null ? {inS: soonS, word: `supertuck in ${soonS}`} : {})}),
            group: meter('group', ds.groupSize, 'none'),
            cda: meter('cda', ds.cda, ds.cdaState || 'model'),
            surface: meter('surface', ds.surfaceW, ds.surfaceId || 'none'),
            // burritos still to come from riders ahead of you in your race (burrito.mjs); blank when none are in play
            burrito: ds.burrito ? meter('burrito', ds.burrito.unfiredAheadN, ds.burrito.state, {firedN: ds.burrito.firedN,
                                        unfiredN: ds.burrito.unfiredN, othersN: ds.burrito.othersN}) :
                meter('burrito', null, 'none'),
            // the pack's demand (30 s): no level, it only reports; pctFtp for the note
            demand: Number.isFinite(ds.demandW) ? {value: ds.demandW, state: 'ok', level: null,
                pctFtp: ds.demandFtpW > 0 ? Math.round(ds.demandW / ds.demandFtpW * 100) : null} :
                {value: null, state: common || 'none', level: null},
            frc: ds.frc ? {value: Math.max(0, ds.frc.leftJ) / 1000,
                           state: ds.frc.frac < 0.1 ? 'empty' : ds.frc.frac < 0.3 ? 'low' : 'ok',
                           level: ds.frc.frac < 0.1 ? 'alarm' : ds.frc.frac < 0.3 ? 'warn' : null,
                           frac: ds.frc.frac, lowKJ: Math.max(0, ds.frc.lowJ) / 1000} :
                {value: null, state: 'none', level: null},
        },
        basics: {
            power: fin(s.power), speed: fin(s.speed), draft: fin(s.draft), cadence: fin(s.cadence),
            // health data: your own only, never a rider you watch
            heartrate: me && me.self ? fin(s.heartrate) : null,
            grade: fin(s.grade),
        },
        call: null,
    };
}
