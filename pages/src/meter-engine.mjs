/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The meters from one `nearby` tick: the same reading of the pack as the Efficiency Meter Data Tap (tap.mjs onNearby,
 * renderGap / renderSide / renderPackCost / renderPosition / renderHolding), with the simple rider model
 * (rider-model.mjs) in place of the Data Tap's equipment table. Pure: no Sauce imports, so it runs headless in tests.
 *
 *   gapM          m to the wheel in line in front (aligned gaps, wheels.mjs); null with no wheel in line within GAP_MAX_M
 *   gapApprox     that gap came from positions, not Sauce's time gap (can be meters off)
 *   noDraftWheel  the wheel in line gives no draft and is the only rider within 20 m ahead (a hand cycle or recumbent
 *                 trike: riders-live.mjs DraftClassifier, learned from everyone's draft behind it). Position is
 *                 blank then: no gap off that wheel saves anything (group ride 2026-10-16: "too close: ease to
 *                 4.5–5.5 m, save ~54 W" for minutes behind a hand cycle, with 0 W of draft at any gap)
 *   sideM         you, to the right (+) or left (−) of the wheel in line, else of the nearest rider ahead beside you
 *                 (both within GAP_MAX_M)
 *   beside        sideM is measured to a rider beside you (no wheel in line)
 *   packW         watts your spot costs beyond Zwift's draft (pack-cost.mjs); null alone, in a pair or settling
 *   packNote      one line: what makes the spot cost that
 *   positionW     what your spot costs against the best-placed rider in your group (position.mjs), 10 s; null alone,
 *                 coasting or settling
 *   positionNote  the move that saves the most from where you sit
 *   holdingW      watts beyond what keeping your place needed, energy balance over 10 s (pair) / 20 s (3+)
 *                 (holding.mjs); null alone, settling or until the window is 80% full
 *   holdingBandW  ± band within which Holding reads as holding
 *   holdingNote   moving up / drifting back / holding place
 *   passWhere     the rider in the passing cue: 'ahead' | 'behind' | 'on your left' | 'on your right'
 *   passAtWheel   your pass starts glued to their wheel (attack)
 *   passWide      you are already 1.5 m+ out from them (attack)
 *   blockedSide   blocked alongside a rider on your 'left' | 'right', else null
 *   blockedStep   blocked on the wheel in line: the side to step to, 'left' | 'right'; null with no room (blocking.mjs stepSide)
 *   surface       the road surface under you from Zwift's map (engine/road-map.mjs), null until the map loads; dirt,
 *                 wood, brick… add their rolling resistance to every meter (2026-10-12 group ride: dirt and wooden
 *                 bridges on the front read +45 W Holding as if pavement)
 *   tuck          the supertuck (engine/supertuck.mjs): {state: 'tucked' | 'ready' | 'build' | 'draft' | 'frame', needKmh,
 *                 inS (build: seconds to tuck speed at the speed you are gaining, when within TUCK_SOON.soonS; else null),
 *                 race (raceFor: true / false / null),
 *                 drag: TuckDrag result (CdA in the tuck vs coasting, this session)} or null off a descent / settling
 *   moveUp        the climb ahead (engine/director.mjs MoveUpCoach, from the Data Tap): {state: 'prep' | 'move' |
 *                 'hold' | 'late', secs (to the foot), priority, source: 'route' | 'riders'} or null; in a group of
 *                 6+. The road ahead: your route (route-ahead.mjs, Sauce's route data: works alone, from the start,
 *                 2026-10-16 checks: the rise over the next km within ~0.7 m median) when you're on one, else the
 *                 road learned from where the riders around you rode (engine/bend-live.mjs BendMap)
 *   ahead         where the road ahead came from: 'route' | 'riders' | null
 *   sprint        the finish (engine/director.mjs SprintCoach, from the Data Tap; distance events, from 1.5 km out):
 *                 {state, priority, held (the power-up you hold), toLineS (seconds to the line along the road ahead),
 *                 remainingM, targetW (the power you can hold from here to the line leaving 3 kJ: sprintBudget)} or
 *                 null. States: position / good (1.5 km), windup (they're going), last / last-go (last wheel of a small
 *                 group), window (you can go from here), take-wheel (a rider coming past before the window), closer
 *                 (dig in), keep-going (after your jump, easing inside 200 m), shake-left / -right
 *                 (drift to shake a follower), fire-<NAME> / prep (your power-up). Advice only: never fired for you.
 *   draftQ        your draft as a share of the most you can get (engine/draft-live.mjs predictedCap), or null
 *   card          the race card's call (race-cards-live.mjs RaceCards; the card for this route, your plan): {about:
 *                 'segment' | 'line' | 'arch' | 'note', kind (sprint / kom / …), plan, power, held, note, inS (seconds to
 *                 the item), endS (to a segment's line), priority, state} or null
 *   surfaceW      watts the surface under you costs your tyres beyond pavement (0 on pavement), surfaceId
 *   surfaceAhead  the next non-pavement stretch within 600 m (along your route past junctions): {surface, inS, forS}
 *                 or null; forS null when its end isn't known (off a route, it runs past this road's end)
 *   bend          a bend ahead (engine/bend-live.mjs bendCue, from the Data Tap; v0.40.0): {state: 'open' (the inside
 *                 is open: moving over gains ground) | 'outside' (you're on the outside, no way in) | 'inside' (on the
 *                 inside already; v0.58.0, from your place on the road, so alone too), side ('left' |
 *                 'right', the bend's way), inS, moveM, gainM, lossM} or null; the same state two ticks running
 *   sCurve        a stretch ahead that twists enough to steer a shorter line (route-ahead.mjs curvyStretch, your route's
 *                 geometry; v0.51.0): {inS, turnDeg (over 100 m), s (bends both ways), dirt} or null; replaces bend
 *   feather       the feather power-up you hold, for the steepest 30 s ahead (engine/powerup-cue.mjs featherCue, from
 *                 the Data Tap; v0.41.0): {state: 'ready' | 'fire', inS (to the steepest part), grade} or null
 *   pacing        the climb ahead (engine/pacing-cue.mjs, from the Data Tap): {state: 'steep' (a steep part ahead:
 *                 inS to it, forS how long it lasts, grade) | 'top' (the crest close while climbing: inS)} or null
 *   frc           your anaerobic reserve (engine/frc-live.mjs, the Data Tap's model): {leftJ, frac, lowJ} or null
 *                 (needs your FTP: the settings', else your Zwift profile's)
 *   nudge         a habit worth changing (engine/director.mjs NudgeCoach, from the Data Tap): {state: 'wheel' (pushing
 *                 into the wheel for nothing, 30 s) | 'middle' (moving up through the middle, 10 s) | 'front' (on the
 *                 front of a group of 6+, 20 s) | 'line' (off the wheel in a small group, 15 s), priority} or null;
 *                 each kind then rests 5 min, all nudges 1 min; quiet before a climb, in the finish, under a power-up
 *   cda           the CdA in use; cdaSource says where it comes from
 *   groupSize     riders in your group (chained ≤ 1 s apart), you included
 *   draftless     you get no draft at all (draftless.mjs: 0 W on a wheel for 10 s at 25 km/h+; a TT bike, a time trial): the pack
 *                 meters read 'draftless' and their calls stop (ds-data.mjs)
 *   settling      you just teleported (group hop): power and speed don't match for ~15 s
 */

import {freshEntries, DraftClassifier} from './engine/riders-live.mjs';
import {wheelsAhead, gapBehind} from './engine/wheels.mjs';
import {RoadGaps} from './engine/road-gaps.mjs';
import {GapCurve, groupLayout} from './engine/gap-curve.mjs';
import {packSituation, packCostW, packCostNote, packCostState, foreAftW, UNIT_PER_M} from './engine/pack-cost.mjs';
import {TeleportGuard} from './engine/teleport.mjs';
import {powerComponents} from './engine/physics.mjs';
import {spotCost, PositionSmoother, POSITION_TAU_S, positionAdvice, positionState, noDraftSpot, GapWatch, DemandMeter, packDemandW, COAST_W, NO_DRAFT_NOTE}
    from './engine/position.mjs';
export {NO_DRAFT_NOTE};
import {HoldingMeter, holdingW, GroupMotion, HOLD_PAIR_S, HOLD_PACK_S, MOTION_MS} from './engine/holding.mjs';
import {BlockWatch, blockedNote, besideRider, stepSide, passSituation, passNote, PassWatch, WIDE_M, GO_KMH} from './engine/blocking.mjs';
import {surfaceExtraCrr} from './engine/road-map.mjs';
import {tuckState, TuckDrag} from './engine/supertuck.mjs';

/*
 * "supertuck in N" (the user, 2026-10-30: "pedal on" 6–13 km/h short on a descent that never got there meant nothing):
 * seconds to tuck speed at the speed you gained over the last windowS, shown only when it's within soonS.
 */
export const TUCK_SOON = {windowS: 3, minGainKmhS: 0.2, soonS: 15};
import {BendMap, lateralSituation, bendCue} from './engine/bend-live.mjs';
import {MoveUpCoach, SprintCoach, IntermediateCoach, NudgeCoach, decelAt, ftpKick, sprintWheels, fastCloser, sprintSettled, SETTLED, KEEP_GOING_M, lateralDepth}
    from './engine/director.mjs';
import {predictedCap, crowdingCue} from './engine/draft-live.mjs';
import {featherCue, FeatherPick} from './engine/powerup-cue.mjs';
import {withSpeeds, secsAlong, curvyStretch, S_CURVE} from './route-ahead.mjs';
import {pacingCue, climbAhead, ClimbClock} from './engine/pacing-cue.mjs';
import {DraftlessWatch} from './draftless.mjs';
import {WheelPick} from './wheel-pick.mjs';
import {RideAwayWatch} from './ride-away.mjs';
import {BridgeWatch, BridgeCoach} from './bridge.mjs';
import {DropWatch} from './drop-watch.mjs';
import {planBridge} from './bridge-plan.mjs';
import {BIKE_LENGTH_M} from './ds-data.mjs';
import {BurritoWatch} from './burrito.mjs';
import {TeamHrWatch, isTeammate, teamTag} from './team-hr.mjs';
import {aroundYou} from './outcome.mjs';

const STEP_KEEP_S = 10;   // the way out of a block stays the same side this long
import {FrcBalance, FRC_DEFAULT_KJ} from './engine/frc-live.mjs';
import {remainingOnSurface, profileAheadOnMap, RoadTraffic} from './engine/road-map.mjs';
import {SURFACES} from './engine/surfaces.mjs';
import {riderModel} from './rider-model.mjs';

const FEATHER_ROAD_M = 15000;
/*
 * Off the back (v0.60.0; the user, 2026-11-07: "close up" read as "I'm drifting off the back", shown 30 s+ and never
 * spoken): Position's close-up with the wheel ahead OFF_BACK.minM+ away (out of its draft) for OFF_BACK.holdS is a
 * don't-get-dropped call, not an efficiency word. 2026-11-07 race: 15–22 m off a group of six for three minutes
 * (27:46–30:40) with no call: the gap yo-yoed, so "losing group" (it needs 6 m of growth in 30 s) never fired.
 */
export const OFF_BACK = {minM: 10, holdS: 3};   // the feather looks up the whole climb (or to the next arch): Alpe du Zwift is 12 km

/*
 * World z (cm) -> altitude (m), learned from your own state: Sauce's altitude is (z − seaLevel) / 100 × the world's
 * slope scale (Watopia 0.5, New York 0.75, London 1), so two of your ticks ALT_FIT_DZ apart in z give it exactly. For
 * the road's profile from Zwift's map (road-map.mjs profileAheadOnMap) when Sauce has no route: 2026-11-04 the map
 * matched the road ridden within 0.22 m of rise per km (research/2026-11-04/map-profile.mjs).
 */
export const ALT_FIT_DZ = 200;
export class AltitudeScale {
    constructor() {
        this.ref = null;
        this.fit = null;
    }

    update(s) {
        if (!s || !Number.isFinite(s.z) || !Number.isFinite(s.altitude) || s.portal) return;
        if (this.ref && this.ref.courseId !== s.courseId) this.ref = this.fit = null;
        if (!this.ref) {
            this.ref = {z: s.z, alt: s.altitude, courseId: s.courseId};
            return;
        }
        const dz = s.z - this.ref.z;
        if (Math.abs(dz) >= ALT_FIT_DZ) {
            const k = (s.altitude - this.ref.alt) / dz;
            this.fit = {k, a: s.altitude - k * s.z};
        }
    }

    /* z -> altitude, or null until you've climbed or descended a little on this course. */
    zToAlt() {
        const f = this.fit;
        return f ? z => f.a + f.k * z : null;
    }
}

export const SETTLING_NOTE = 'teleported: settling';
export const COASTING_NOTE = 'coasting: draft only adds speed';
export const DESCENT_NOTE = 'fast descent: the draft mostly adds speed, your gap closes by itself';
export const POSITION_DESCENT = {kmh: 45, grade: -0.02};   // Position quiet this fast on a descent this steep (v0.60.1)
export const ALONE_NOTE = 'not in a group';
// Beyond this there is no wheel to speak of (no draft left; pack-cost.mjs reads the wheel in line within 25 m too).
export const GAP_MAX_M = 25;
export const FINALE_M = 1500;   // the finish calls' stretch (SprintCoach's "top ten" starts 1.7 km out)

/* The rider the meters are for: you when Sauce knows you, else the rider being watched. */
export function meterRider(all) {
    return all.find(x => x && x.self) || all.find(x => x && x.watching) || null;
}

/*
 * Holding's state follows the cause (docs/DS-DATA.md, the user 2026-10-16): over the band because you're blocked ->
 * 'blocked' (never "easy": the fix is to steer out), while moving up -> 'moving-up' (the price of the move), else
 * 'easy'; within the band 'hold'; under it 'drifting'. null value -> 'warming'.
 */
export function holdingStateOf(w, bandW, blocked, rel) {
    if (w == null) return 'warming';
    if (w > bandW) return blocked ? 'blocked' : rel != null && rel > MOTION_MS ? 'moving-up' : 'easy';
    if (w < -bandW) return 'drifting';
    return 'hold';
}

export const THROUGH_S = 3;   // moving up through your group: your speed over theirs, averaged this long (calls.mjs THROUGH_KMH)

export class MeterEngine {
    /*
     * gapCurve: the draft-by-gap curve (gap-curve.mjs: crude steps, no learning).
     * modelFor(entry): the rider model for the meter rider (default: a road bike × their profile size).
     * roadMap: Zwift's road surfaces (engine/road-map.mjs RoadMap); none = everything is pavement.
     * routeAhead: your route's profile (route-ahead.mjs RouteAhead); none = the road learned from the riders only.
     * raceCards: the race card for your event's route (race-cards-live.mjs RaceCards); none = no card calls.
     * fitnessFor(me): {ftpW, frcJ, pMaxW (null: 4.5 × FTP)} for the FRC meter and the bridge (default: the Zwift profile's FTP, 15 kJ).
     * raceFor(me): true in a race event (Zwift's race physics), false outside one, null not known yet. The supertuck
     * pays only in races (Zwift Insider: about as aero as the AERO power-up there; outside races no drag cut, measured).
     */
    constructor({gapCurve = new GapCurve(), modelFor = me => riderModel({athlete: me.athlete}), roadMap = null,
                 routeAhead = null, raceCards = null,
                 fitnessFor = me => ({ftpW: me.athlete && me.athlete.ftp, frcJ: FRC_DEFAULT_KJ * 1000}),
                 raceFor = () => null} = {}) {
        this.interCoach = new IntermediateCoach();   // ease off / to FTP at a contested intermediate sprint (race card)
        this.fitnessFor = fitnessFor;
        this.raceFor = raceFor;
        this.frcBalance = new FrcBalance();   // yours (a camera change doesn't touch it: it reads your ticks only)
        this.raceCards = raceCards;
        this.gapCurve = gapCurve;
        this.modelFor = modelFor;
        this.roadMap = roadMap;
        this.routeAhead = routeAhead;
        this.athleteId = null;
        this.draftClass = new DraftClassifier();   // about the other riders: kept across camera changes
        this.tuckDrag = new TuckDrag();             // your tucks this session (a camera change doesn't matter: own ticks only)
        this.bendMap = new BendMap();               // the road, learned from where every rider rode: kept across camera changes
        this.roadGaps = new RoadGaps();             // roads Sauce has no map for (its gaps all 0): kept across camera changes
        this.altScale = new AltitudeScale();        // your z -> altitude (the map's road profile off a route)
        this.roadTraffic = new RoadTraffic();       // where the riders went (the map's way at a junction off a route)
        this.gapSource = 'sauce';
        this.startRider();
    }

    /* Seconds until you reach tuck speed at the rate you're gaining it (your last TUCK_SOON.windowS), when within soonS; else null. */
    tuckIn(s, needKmh) {
        const h = this.tuckSpeeds;
        if (Number.isFinite(s.worldTime) && Number.isFinite(s.speed) && (!h.length || s.worldTime > h.at(-1).wt)) {
            h.push({wt: s.worldTime, kmh: s.speed});
        }
        while (h.length > 2 && h[1].wt <= s.worldTime - TUCK_SOON.windowS * 1000) h.shift();
        if (!(needKmh > 0) || h.length < 2) return null;
        const dt = (h.at(-1).wt - h[0].wt) / 1000;
        if (dt < TUCK_SOON.windowS - 1) return null;
        const gain = (h.at(-1).kmh - h[0].kmh) / dt;
        const inS = gain >= TUCK_SOON.minGainKmhS ? needKmh / gain : null;
        return inS != null && inS <= TUCK_SOON.soonS ? inS : null;
    }

    /* A different rider (a camera change): their teleports, windows and smoothing start over. */
    startRider() {
        this.teleport = new TeleportGuard({newcomers: false});
        this.roadGaps.restart();
        this.position = new PositionSmoother();
        this.tuckSpeeds = [];
        this.posQuietWt = null;   // the last tick of a gap opening / shatter: Position gives no advice for POSITION_TAU_S after
        this.posGapOn = false;    // that was the last tick (the next one starts Position over)
        this.gapWatch = new GapWatch();   // a hole opening in front of your wheel (or the next): about to be gapped
        this.rideAway = new RideAwayWatch();   // the group ahead leaves or splits: no "ease off" / "back off" then
        this.bridge = new BridgeWatch();       // you're closing on riders up the road: no gap advice to the wheel you caught
        this.dropWatch = new DropWatch();      // you're losing the group you rode with (drop-watch.mjs): "losing the group"
        this.bridgeCoach = new BridgeCoach();  // the bridge call, while bridgeArmed (the window's Bridge button)
        this.teamHrWatch = new TeamHrWatch();     // a teammate in your race with no heart rate (pen and race)
        this.burritoWatch = new BurritoWatch();   // burritos fired in your event: the cone ahead, how many are still to come
        this.accel = null;    // {wt, kmh, a}: your acceleration (km/h per s, ~2 s), to time-align the passing cue's speeds
        this.gapFor = null;               // whose (a camera change starts it fresh)
        this.throughPts = [];             // [{wt, d}]: you minus your group's speed (through())
        this.demand = new DemandMeter();  // the pack's demand: the ideal spot's power to hold your group, 30 s
        this.holding = new HoldingMeter();
        this.motion = new GroupMotion();
        this.block = new BlockWatch();
        this.pass = new PassWatch();
        this.wheelHist = [];   // [{wt, id, gap}]: the wheel in line, ~4 s, for how fast you're really closing on it
        this.moveUpCoach = new MoveUpCoach();
        this.featherPick = new FeatherPick();   // the feather's target held where it is on the road (spent once passed)
        this.climbClock = new ClimbClock();   // how long you've been climbing ("over top" only after a real climb)
        this.wheelPick = new WheelPick();   // your wheel: in line, or up to 1 m aside (v0.60.1)
        this.draftlessWatch = new DraftlessWatch();   // you get no draft at all (a TT bike, a time trial): pack calls off
        this.bendLast = null;                 // the bend cue's state last tick (called once it holds two ticks)
        this.sprintCoach = new SprintCoach();
        this.nudgeCoach = new NudgeCoach();
        this.pace = null;     // {wt, vFlat, power}: your flat speed and effort, smoothed, for the seconds ahead
        this.holdClass = 0;   // 1 = alone, 2 = with one rider, 3 = group of 3+: Holding restarts when it changes
    }

    /* One tick: the meter rider's entry and their meters, or null with nobody to read. */
    /* The side to step to: once called it stays through the block while it is free (STEP_KEEP_S after the last time asked). */
    stepFor(entries, me) {
        const wt = me.state.worldTime, was = this.stepWas;
        const side = stepSide(entries, me, undefined, {keep: was && wt - was.wt <= STEP_KEEP_S * 1000 ? was.side : null});
        this.stepWas = side ? {side, wt} : was;
        return side;
    }

    /* Your speed over your group's, km/h, averaged over THROUGH_S (null when there's nothing to compare: it starts over). */
    through(wt, d) {
        if (!Number.isFinite(d) || !Number.isFinite(wt)) {
            this.throughPts = [];
            return null;
        }
        this.throughPts.push({wt, d});
        while (this.throughPts.length && this.throughPts[0].wt < wt - THROUGH_S * 1000) this.throughPts.shift();
        return this.throughPts.reduce((a, x) => a + x.d, 0) / this.throughPts.length;
    }

    update(all) {
        if (!Array.isArray(all)) return null;
        const me = meterRider(all);
        if (!me || !me.state) return null;
        if (me.athleteId !== this.athleteId) {
            this.athleteId = me.athleteId;
            this.startRider();
        }
        const s = me.state;
        const v = (s.speed || 0) / 3.6;
        const power = s.power || 0;
        // on a road Sauce has no map for, its gaps are all 0: measured from the road completion instead, or none (road-gaps.mjs)
        const fixed = this.roadGaps.update(all, me);
        if (fixed.source !== this.gapSource) {   // what the watches saw on the other side of the change means nothing now
            this.gapSource = fixed.source;
            this.gapWatch.reset();
            this.rideAway.reset();
            this.bridge.reset();
            this.dropWatch.reset();
            this.offBackFrom = null;
            this.wheelPick.reset();
            this.position.reset();
            this.posQuietWt = null;
            this.posGapOn = false;
        }
        const entries = freshEntries(fixed.entries, me);   // frozen avatars stay in the list ~15 s: read current states only
        const aheadMap = wheelsAhead(entries);
        this.draftClass.update(entries, aheadMap);
        const ahead = aheadMap.get(me.athleteId) || null;
        const near = w => (w && w.gap <= GAP_MAX_M ? w : null);
        // your draft quality (share of your cap): the finish, bends, and which wheel gives it
        const cap = me.athlete && me.athlete.height > 0 && me.athlete.weight > 0 ?
            predictedCap({heightCm: me.athlete.height, weightKg: me.athlete.weight}) : null;
        const draftQ = cap && v > 3 ? (s.draft || 0) / (cap * 0.5 * 1.225 * v ** 3) : null;
        // v0.60.1: the wheel giving you draft, in line or a little aside (wheel-pick.mjs); wheels.mjs's in line is 0.44 m
        const inline = near(this.wheelPick.update(entries, me, {q: draftQ}));
        const layout = groupLayout(entries);
        this.gapCurve.ingest(entries, layout);
        const layoutL = layout.get(me.athleteId) || {size: 1, ahead: 0, vGroup: null, gapAhead: null};
        // Position's gap is the wheel in line when there is one, the one the Gap meter shows (2026-10-31: "back off" at a
        // shown 3.1 m because a rider half a lane over was 0.4 m ahead; 110 of 350 "back off" ticks were on another rider)
        const L = inline ? {...layoutL, gapAhead: inline.gap} : layoutL;
        const settling = this.teleport.settling(me.athleteId, {wt: s.worldTime, x: s.x, y: s.y, v});
        // moving up through your group (calls.mjs THROUGH_KMH, v0.57.0): you minus your group's median speed, km/h, over
        // THROUGH_S; none alone, in a pair or while settling
        const throughKmh = this.through(s.worldTime, !settling && L.size >= 3 && Number.isFinite(L.vGroup) ? (v - L.vGroup) * 3.6 : null);
        this.bendMap.ingest(all);

        const noDraft = noDraftSpot(this.draftClass, {ahead, L, layout, entries, me, maxGapM: GAP_MAX_M});
        const noDraftWheel = noDraft.wheel;
        // burritos fired in your event (burrito.mjs): their cones take everyone's draft, so no draftless read while one is
        // active; on roads Sauce has no map for the wheel is estimated, so it takes twice as long (v0.60.1: 10-27 and 11-07 races on road bikes, 0 W for 10–11 s on a wheel)
        const burrito = me.self && !settling ? this.burritoWatch.update(entries, me, s.worldTime) : null;
        const draftless = me.self && this.draftlessWatch.update({wt: s.worldTime, draft: s.draft, gapM: inline ? inline.gap : null, kmh: s.speed || 0,
                                                                 noDraftWheel: !!noDraftWheel || !!(burrito && burrito.activeN > 0),
                                                                 sure: this.gapSource === 'sauce'});   // estimated gaps: twice as long
        const wheel = inline || near(ahead);
        const sideM = wheel && Number.isFinite(wheel.lane) ?
            -wheel.lane / UNIT_PER_M * (s.reverse ? -1 : 1) : null;

        const sit = packSituation(entries, me);
        if (this.roadMap) this.roadMap.ensure(s.courseId);
        const surface = this.roadMap ? this.roadMap.at(s)?.surface ?? null : null;
        const base = this.modelFor(me);
        const model = {...base, crr: base.crr + (surface ? surfaceExtraCrr(surface, base.tyre || 'road') : 0)};
        // pack cost priced with your pavement Crr: riders pay the same pack extra on dirt as on pavement (2026-10-30, 6
        // recordings: +0.0022 vs +0.0027 in Crr); with the surface in, a tight spot read 96 W on dirt vs 22 W on pavement
        const packW = packCostW(sit, L, v, {massKg: model.massKg, cda: model.cda, crr: base.crr});
        const c = powerComponents({v, grade: s.grade || 0, massKg: model.massKg, cda: model.cda, crr: model.crr,
                                   draftW: s.draft || 0});
        const spot = spotCost(this.gapCurve, L, c, s, v, me.athleteId, packW);   // the same pack cost as Holding
        if (this.gapFor !== me.athleteId) {
            this.gapFor = me.athleteId;
            this.gapWatch.reset();
            this.demand.reset();
        }
        const demandW = this.demand.update(s.worldTime, !settling && L.size >= 2 ? packDemandW(c, spot) : null, {v, massKg: model.massKg});
        const gapping = settling ? null : this.gapWatch.update(entries, me, s.worldTime);
        // the riders ahead riding away or splitting (ride-away.mjs): "gap opening" / "group shattering", never "back off",
        // "ease off", "drop back" or "drift back"
        if (settling || L.size < 2) this.rideAway.reset();
        const away = settling || L.size < 2 ? null : this.rideAway.update(entries, me, s.worldTime);
        if (settling) this.bridge.reset();
        const upRoad = settling ? null : this.bridge.update(entries, me, s.worldTime);
        const bridging = upRoad && upRoad.closing ? upRoad : null;
        // losing the group you rode with (v0.58.0): watched on after you're out of it, unlike GapWatch and ride-away
        if (settling) this.dropWatch.reset();
        const drop = settling ? null : this.dropWatch.update(entries, me, s.worldTime);
        const pos = this.readPosition(s, spot, L, settling, power, noDraft.spot, away && away.state === 'shatter' ? {which: 'shatter'} :
            gapping || (away && {which: 'group', mps: away.mps}) || (drop && {which: 'drop', ...drop}) || (bridging && {which: 'bridge', ...bridging}));
        // off the back: close-up 10 m+ from the wheel ahead, held (OFF_BACK)
        const offNow = me.self && !settling && pos.state === 'close-up' && L.gapAhead != null && L.gapAhead >= OFF_BACK.minM;
        this.offBackFrom = offNow ? (this.offBackFrom ?? s.worldTime) : null;
        const offBack = offNow && s.worldTime - this.offBackFrom >= OFF_BACK.holdS * 1000;
        if (settling) this.block.reset();
        const blkRead = this.block.update({wt: s.worldTime, v, alt: s.altitude, power, draft: s.draft || 0,
                                       massKg: model.massKg, bodyKg: me.athlete?.weight, cda: model.cda, crr: model.crr, packW,
                                       wheelGapM: sit ? sit.wheelGap : null, ahead3: sit ? sit.ahead3 : 0,
                                       behind: L.size >= 2 && L.ahead > 0, beside: L.size >= 2 ? besideRider(entries, me) : null,
                                       powerUp: s.activePowerUp, coffee: s.coffeeStop});
        // the measured loss stays (blockedW); only the cue goes while they ride away
        const blk = (away || drop || bridging) && blkRead.blocked ? {...blkRead, blocked: false} : blkRead;
        const holdRead = this.readHolding(s, c, spot, L, v, packW, power, model, settling, blk);
        const hold = (away || drop || bridging) && holdRead.state === 'easy' ? {...holdRead, state: 'hold'} : holdRead;   // "easy": not now
        const ac = this.accel, dtAc = ac && Number.isFinite(s.worldTime) ? (s.worldTime - ac.wt) / 1000 : null;
        const accelKmhS = dtAc > 0 && dtAc < 5 ? ac.a + (1 - Math.exp(-dtAc / 2)) * (((s.speed || 0) - ac.kmh) / dtAc - ac.a) : ac ? ac.a : 0;
        if (!ac || dtAc !== 0) this.accel = {wt: s.worldTime, kmh: s.speed || 0, a: dtAc > 0 && dtAc < 5 ? accelKmhS : 0};
        // a rider creeping up on you: "block left / right" in a race (or practice race) only, never a teammate; straight
        // behind there is nothing to do (the user, 2026-10-30: "hold line" said don't do anything)
        const passSit = settling || L.size < 2 ? null : passSituation(entries, me, undefined, {accelKmhS});
        const d = passSit && passSit.defend;
        if (d && (this.raceFor(me) !== true || d.where === 'behind' || isTeammate(d.rider && d.rider.athlete, teamTag(me.athlete)))) {
            passSit.defend = null;
        }
        // closing on the wheel at GO_KMH+ by the gap over the last 2–4 s: you're coming through, whatever the speeds say
        // (2026-10-31 43:20: "drop back" at 0.8 m, +4.7 km/h by speed, 11.9 -> 0.8 m in 7 s = +5.7 as they took your
        // draft on the climb; you went straight past)
        if (inline && Number.isFinite(s.worldTime)) {
            if (this.wheelHist.length && this.wheelHist.at(-1).id !== inline.id) this.wheelHist = [];
            if (!this.wheelHist.length || s.worldTime > this.wheelHist.at(-1).wt) this.wheelHist.push({wt: s.worldTime, id: inline.id, gap: inline.gap});
            while (this.wheelHist.length > 1 && this.wheelHist[0].wt < s.worldTime - 4000) this.wheelHist.shift();
        } else {
            this.wheelHist = [];
        }
        const wh0 = this.wheelHist[0], whN = this.wheelHist.at(-1);
        const wheelCloseKmh = wh0 && whN.wt - wh0.wt >= 2000 ? (wh0.gap - whN.gap) / ((whN.wt - wh0.wt) / 1000) * 3.6 : null;
        if (passSit && passSit.attack && whN && passSit.attack.id === whN.id && wheelCloseKmh >= GO_KMH) passSit.attack = null;
        const passRead = this.pass.update(passSit);
        const pass = !away ? passRead : {...passRead, attack: null, defend: away.state === 'shatter' ? null : passRead.defend};
        // the road ahead (yours only: the learned road follows your own track, the route is yours). Its seconds use
        // steady inputs: your flat speed (smoothed ~30 s while the road is within ±2%) and effort (power, ~60 s)
        const pc = this.pace;
        const dtA = pc && Number.isFinite(s.worldTime) ? (s.worldTime - pc.wt) / 1000 : null;
        const ok = dtA > 0 && dtA < 10;
        const flatNow = Math.abs(s.grade || 0) <= 0.02 && v > 2;
        this.pace = {
            wt: s.worldTime,
            vFlat: !pc || pc.vFlat == null ? (flatNow ? v : null) :
                ok && flatNow ? pc.vFlat + (1 - Math.exp(-dtA / 30)) * (v - pc.vFlat) : pc.vFlat,
            power: !ok ? (pc ? pc.power : power) : pc.power + (1 - Math.exp(-dtA / 60)) * (power - pc.power),
        };
        const vA = this.pace.vFlat ?? v;
        // the road ahead: your route (Sauce's), else Zwift's map along this road (or the route's sections), else the road
        // learned from the riders ahead. aheadOpen: the road past its end is unknown (the riders' road stops where they
        // are; the map's at a junction off a route), so its end is no climb's top (powerup-cue.mjs topUnseen)
        let roadAhead = null, aheadFrom = null, aheadOpen = false;
        const speedsOf = pts => withSpeeds(pts, {vFlat: vA, power: this.pace.power, massKg: model.massKg, cda: model.cda,
                                                 crr: model.crr, bodyKg: me.athlete?.weight, vNow: v});
        const sections = this.routeAhead ? this.routeAhead.sections(s) : null;
        const zToAlt = me.self ? (this.altScale.update(s), this.altScale.zToAlt()) : null;
        // off a route, at a junction the way most riders ahead went (your subgroup in an event)
        if (me.self) this.roadTraffic.update(entries, me);
        const traffic = this.roadTraffic.on(s.courseId);
        const onMap = maxM => (this.roadMap && zToAlt ? profileAheadOnMap(this.roadMap, s, maxM, zToAlt, {route: sections, traffic}) : null);
        if (me.self) {
            const route = this.routeAhead ? this.routeAhead.ahead(s, 3000) : null;
            const map = route && route.length >= 4 ? null : onMap(3000);
            if (route && route.length >= 4) {
                roadAhead = speedsOf(route);
                aheadFrom = 'route';
            } else if (map && map.pts.length >= 4) {
                roadAhead = speedsOf(map.pts);
                aheadFrom = 'map';
                aheadOpen = map.open;
            } else {
                const road = this.bendMap.roadAhead(s, 800, sections);
                if (road && road.pts && road.pts.length) {
                    roadAhead = road.pts;
                    aheadFrom = 'riders';
                    aheadOpen = true;
                }
            }
        }
        // the route's and the map's speeds are already yours (withSpeeds); the riders' are rescaled by the coaches
        const exactAhead = aheadFrom === 'route' || aheadFrom === 'map';
        // your FRC balance (the sprint coach plans the finish on it)
        let frc = null;
        const fit = me.self ? this.fitnessFor(me) || {} : {};
        if (me.self && fit.ftpW > 0 && fit.frcJ > 0) frc = this.frcBalance.update(s.worldTime, power, fit);
        // the bridge you asked for (the Bridge button): when and where it costs the least FRC, then pacing (bridge.mjs)
        // in the finish too (the user, 2026-10-31: "It should be very useful during the sprint"): on before the line
        const toLineM = me.remainingType === 'event' && me.remainingMetric === 'distance' && me.remaining > 0 ? me.remaining : null;
        const bridgeCall = me.self && !settling && fit.ftpW > 0 ? this.bridgeCoach.update({
            wt: s.worldTime, armed: !!this.bridgeArmed, up: upRoad, power, ftpW: fit.ftpW,
            plan: ({going}) => (upRoad && upRoad.vGroup > 1 ? planBridge({
                gapS: upRoad.aheadM / upRoad.vGroup, rateSps: upRoad.closeMps != null ? -upRoad.closeMps / upRoad.vGroup : 0,
                vGroup: upRoad.vGroup, grade: s.grade || 0, profile: roadAhead, model,
                ftpW: fit.ftpW, frcLeftJ: frc ? frc.leftJ : fit.frcJ, attack: !going, pMaxW: fit.pMaxW, frcCapJ: fit.frcJ,
                toLineM}) : null),
        }) : null;
        if (bridgeCall && bridgeCall.done) this.bridgeArmed = false;
        // the finish: your draft quality (draftQ above), then the sprint coach (distance events only)
        // settled while you ride FTP: you slow by what FTP leaves short of your drag (AERO: CdA × 0.75)
        const easeModel = {cda: model.cda * (s.activePowerUp === 'AERO' ? 0.75 : 1), crr: model.crr, massKg: model.massKg};
        const settledFtp = (toLineM, near) => near && fit.ftpW > 0 &&
            sprintSettled(entries, me, toLineM, {decelMs2: decelAt(fit.ftpW, v, easeModel), kickKmh: ftpKick});
        // practice race on a free ride (raceFor true with no event): your route's end is the finish line (Sauce: lead-in
        // + one lap, the route distance starts over each lap). A free ride otherwise has no line (v0.34.0)
        const finishType = me.remainingType === 'route' && !s.eventSubgroupId && this.raceFor(me) === true ? 'event' : me.remainingType;
        // seconds to the line along the road ahead (its climbs and descents): the last-wheel call is timed by it
        const inEventFinish = finishType === 'event' && me.remainingMetric === 'distance' && me.remaining > 0 && me.remaining < 3000;
        const toLineS = inEventFinish ? secsAlong(roadAhead, me.remaining, this.pace.vFlat ?? v) : null;
        // the power-up you hold, on any bike (v0.46.1; the user, 2026-10-26: "if we have a power up yes the call should
        // come": AERO on the Hanzo cut the drag 0.25 -> 0.17). On a TT bike the next arch takes it (tt: race card calls)
        const held = me.gameState ? me.gameState.availablePowerUp || null : null;
        const tt = base.bike === 'tt';
        const finish = settling || !me.self ? null : this.sprintCoach.update({
            wt: s.worldTime, remaining: me.remaining, remainingMetric: me.remainingMetric, remainingType: finishType,
            v, power, held, bike: base.bike, toLineS,
            group: {size: L.size, ahead: L.ahead, vGroup: L.vGroup}, wheels: sprintWheels(entries, me),
            canSteer: !!s.canSteer, q: draftQ, closer: fastCloser(entries, me), frc, ftpW: fit.ftpW, model: easeModel,
            settled: me.remaining < SETTLED.fromM && this.gapSource !== 'none' && sprintSettled(entries, me, me.remaining),
            settledFtp: settledFtp(me.remaining, me.remainingMetric === 'distance' && me.remaining < KEEP_GOING_M * 2)});
        // an intermediate sprint on the race card: the same ease calls (the finish's own calls win)
        const line = settling || !me.self || !this.raceCards ? null : this.raceCards.sprintLine(s);
        const inter = settling || !me.self ? null : this.interCoach.update({
            wt: s.worldTime, toLineM: line ? line.toLineM : null, lineKey: line ? line.key : null, v, power, ftpW: fit.ftpW,
            settled: !!line && line.toLineM < KEEP_GOING_M * 2 && sprintSettled(entries, me, line.toLineM),
            settledFtp: !!line && settledFtp(line.toLineM, line.toLineM < KEEP_GOING_M * 2)});
        const climb = settling || !me.self ? null :
            // the coach rescales the speeds ahead by v / (speed at the first point): right for the riders' speeds, but
            // the route's are already yours, so v = that first speed (scale 1). With your flat speed instead, a ramp
            // right ahead doubled the scale and halved the seconds (Urumaze 2026-10-06: 149 -> 72 s in 2 s).
            this.moveUpCoach.update({profile: roadAhead, v: exactAhead && roadAhead[0] ? roadAhead[0].v : vA,
                                     grade: s.grade || 0, group: L, exactFoot: exactAhead});
        // no draft at all on a wheel: a TT bike, whatever the settings say, and a TT frame can't supertuck (2026-10-30:
        // "pedal on" on the Hanzo, the bike setting not TT)
        const tuckIn = {kmh: s.speed, grade: s.grade, power, draft: s.draft || 0, bike: draftless ? 'tt' : base.bike,
                        powerUp: s.activePowerUp};
        const tuck0 = settling ? null : tuckState(tuckIn);
        const tuckSoonS = me.self ? this.tuckIn(s, tuck0 && tuck0.state === 'build' ? tuck0.needKmh : null) : null;
        const tuck = tuck0 && tuck0.state === 'build' ? {...tuck0, inS: tuckSoonS} : tuck0;
        if (me.self) {
            this.tuckDrag.update({wt: s.worldTime, v, alt: s.altitude, dist: s.distance, power, massKg: model.massKg,
                                  crr: model.crr, kind: settling ? null : TuckDrag.kind(tuck, tuckIn), powerUp: s.activePowerUp});
        }

        // crowding the wheel (under 1 m at full draft: a habit, "give room"; draft-live.mjs crowdingCue)
        const crowding = !!(me.self && !settling && !draftless && ahead &&
            crowdingCue({q: draftQ, aheadGap: ahead.gap, aheadLane: ahead.lane, ahead20: ahead.counts[2],
                         powerUp: s.activePowerUp, behindGap: gapBehind(entries, me.athleteId)}).state === 'crowding');
        // habits (yours only): quiet before a climb, in the finish (2 km) and under a power-up, as in the Data Tap
        const finale = finishType === 'event' && me.remainingMetric === 'distance' && me.remaining > 0 && me.remaining < 2000;
        const nudge = settling || !me.self ? null : this.nudgeCoach.update({
            wt: s.worldTime, size: L.size, ahead: L.ahead, holdW: hold.w, relMs: Number.isFinite(L.vGroup) ? v - L.vGroup : 0,
            depthM: lateralDepth(entries, me), q: draftQ, gapAhead: layoutL.gapAhead ?? null, positionW: pos.w, crowding,
            quiet: !!(climb && climb.state) || finale || !!s.activePowerUp});
        // the race card for this route (yours only, in an event)
        const cardCall = settling || !me.self || !this.raceCards ? null :
            this.raceCards.call(s, {held, v, tt, riders: entries});
        // ride warnings (yours only): the surface here and ahead, the climb's pacing, your reserve
        const vAhead = this.pace.vFlat ?? v;
        const crrOf = id => {
            const x = SURFACES.find(y => y.id === id);
            return x ? x.crr[base.tyre || 'road'] ?? x.crr.road : null;
        };
        const pave = crrOf('pavement');
        const surfaceW = surface && surface !== 'pavement' && crrOf(surface) != null ?
            Math.max(0, (crrOf(surface) - pave) * model.massKg * 9.80665 * Math.max(v, 1)) : 0;
        let surfaceAhead = null;
        if (this.roadMap && me.self && !settling && (!surface || surface === 'pavement' || surface === 'sand')) {
            const ah = this.roadMap.ahead(s, 600, this.routeAhead ? this.routeAhead.sections(s) : null);
            if (ah) {
                const inS = secsAlong(roadAhead, ah.inM, vAhead);
                const outS = secsAlong(roadAhead, ah.inM + ah.lengthM, vAhead);
                surfaceAhead = {surface: ah.surface, inS, forS: !ah.open && inS != null && outS != null ? outS - inS : null};
            }
        }
        let pacing = null;
        const climbedS = me.self ? this.climbClock.update(s.worldTime, s.grade || 0) : 0;
        if (me.self && !settling && roadAhead) {
            const pv = exactAhead && roadAhead[0] ? roadAhead[0].v : vAhead;   // no rescale on the route's / map's speeds
            const pc = pacingCue({profile: roadAhead, v: pv, grade: s.grade || 0, climbedS});
            if (pc.state === 'ready') {
                const st = (climbAhead(roadAhead, {vNow: pv, grade: s.grade || 0}) || {}).steep;
                const inS = secsAlong(roadAhead, pc.startM, vAhead);
                const endS = st ? secsAlong(roadAhead, st.endM, vAhead) : null;
                pacing = {state: 'steep', inS, forS: inS != null && endS != null ? endS - inS : null, grade: pc.grade};
            } else if (pc.state === 'top') {
                pacing = {state: 'top', inS: secsAlong(roadAhead, pc.crestM, vAhead)};
            }
        }
        // a bend ahead (yours only): take the inside when it pays (bend-live.mjs bendCue)
        let bend = null;
        const self3 = this.bendMap.self;
        if (me.self && !settling && v > 5 && self3.length >= 3) {
            const [p0, p1, p2] = self3;
            const L0 = Math.hypot(p1.x - p0.x, p1.y - p0.y), L1 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (L0 > 100 && L1 > 100) {
                const dir = [(p2.x - p1.x) / L1, (p2.y - p1.y) / L1];
                let turn = Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.atan2(p1.y - p0.y, p1.x - p0.x);
                turn = Math.atan2(Math.sin(turn), Math.cos(turn));
                const b = this.bendMap.nextBend(s, 200, undefined, this.routeAhead ? this.routeAhead.sections(s) : null);
                const lat = b ? lateralSituation(entries, me, dir, Math.sign(b.angleDeg), turn / ((L0 + L1) / 200), {right: b.right}) : null;
                const cue = bendCue(b, lat, {v, q: draftQ ?? 0, cap: cap ?? 0.14, cda: model.cda,
                                             fRollN: model.crr * model.massKg * 9.80665});
                const key = cue.state ? `${cue.state}-${b.right ? 'right' : 'left'}` : null;
                if (key && key === this.bendLast) {
                    bend = {state: cue.state, side: b.right ? 'right' : 'left', inS: b.startM / v,
                            moveM: cue.moveM, gainM: cue.gainM, lossM: cue.lossM};
                }
                this.bendLast = key;
            }
        }
        // cut the S: a stretch ahead that twists enough for a steered line to pay (route-ahead.mjs curvyStretch, from the
        // route's own geometry, traced every 5 m): dirt from S_CURVE.dirtDeg, pavement from paveDeg. It replaces the bend call.
        let sCurve = null;
        if (me.self && !settling && v > 5 && aheadFrom === 'route' && roadAhead) {
            const rough = x => x === 'dirt' || x === 'gravel';
            const run = this.roadMap ? this.roadMap.ahead(s, S_CURVE.toM + S_CURVE.winM, this.routeAhead ? this.routeAhead.sections(s) : null) : null;
            const roughAt = (a, b) => !!run && rough(run.surface) && run.inM <= b && (run.open || run.inM + run.lengthM >= a);
            const c = curvyStretch(roadAhead, (a, b) => (roughAt(a, b) ? S_CURVE.dirtDeg : S_CURVE.paveDeg));
            const inS = c ? secsAlong(roadAhead, c.startM, vAhead) : null;
            if (c && inS != null && inS <= S_CURVE.callS) {
                sCurve = {inS, turnDeg: Math.round(c.turnDeg), s: c.s, dirt: roughAt(c.startM, c.endM)};
                bend = null;
            }
        }
        // the feather you hold: at the steepest 30 s ahead
        // up the whole climb (to the next arch at most): the route's profile further than the 3 km above (Alpe du Zwift 12 km)
        // the map's off a route (2026-11-04: no route for the event; the riders' road ended 650 m up a 6.8 km climb)
        let featherRoad = roadAhead, featherOpen = aheadOpen;
        if (me.self && !settling && held === 'LIGHTNESS' && aheadFrom === 'route') {
            const far = this.routeAhead.ahead(s, FEATHER_ROAD_M);
            if (far && far.length >= 4) featherRoad = speedsOf(far);
        } else if (me.self && !settling && held === 'LIGHTNESS' && aheadFrom === 'map') {
            const far = onMap(FEATHER_ROAD_M);
            if (far && far.pts.length >= 4) {
                featherRoad = speedsOf(far.pts);
                featherOpen = far.open;
            }
        }
        const fc0 = me.self && !settling && featherRoad && held === 'LIGHTNESS' ?
            featherCue({held, profile: featherRoad, v, grade: s.grade || 0, open: featherOpen,
                        archM: this.raceCards ? this.raceCards.nextArch(s, {tt}) : null}) : null;
        const fc = this.featherPick.update(fc0, {odoM: s.distance, v});
        // 'wait' too (no call): a steeper part is still ahead, so the finish's "FEATHER at jump" stays quiet (ds-data)
        // the seconds: the climb's speeds, and never faster than you're riding while you climb (2026-10-31: "fire in 4" at
        // 64 m and 15 km/h, the flat pace's seconds)
        const feather = fc && fc.state ? {state: fc.state, grade: fc.grade,
                                          inS: Math.max(secsAlong(featherRoad, fc.startM, this.pace.vFlat ?? v) || 0,
                                                        (s.grade || 0) >= 0.015 ? fc.startM / Math.max(v, 2) : 0)} : null;
        const ds = {
            ts: s.worldTime,
            gapM: inline ? inline.gap : null,
            gapApprox: !!(inline && (inline.gapSource === 'distance' || this.gapSource === 'road')),
            gapSource: this.gapSource,
            around: me.self ? aroundYou(entries, me) : [],   // outcome.mjs: did the call work?
            passRiderId: pass.defend?.rider?.athleteId ?? null,
            powerW: power,
            steering: !!s.activeSteer,
            canSteer: s.canSteer !== false,
            lane: (s.roadPosition ?? 0) / UNIT_PER_M * (s.reverse ? -1 : 1),   // m toward your right along the road's width
            noDraftWheel,
            sideM,
            beside: !!(wheel && !inline),
            packW: !settling && L.size >= 3 ? packW : null,
            packNote: settling ? SETTLING_NOTE : packCostNote(sit, L),
            positionW: pos.w,
            positionNote: pos.note,
            holdingW: hold.w,
            holdingBandW: hold.bandW,
            holdingNote: hold.note,
            blockedW: settling || L.size < 2 ? null : blk.lostW,
            blockedNote: settling ? SETTLING_NOTE : L.size < 2 ? ALONE_NOTE : blockedNote(blk),
            blocked: !settling && L.size >= 2 && blk.blocked,
            passKmh: pass.attack ? pass.attack.closeKmh : pass.defend ? pass.defend.closeKmh : null,
            passKind: pass.attack ? 'attack' : pass.defend ? 'defend' : null,
            passNote: passNote(pass),
            passWhere: (pass.attack || pass.defend)?.where ?? null,
            passAtWheel: !!pass.attack?.atWheel,
            passWide: !!pass.attack && Math.abs(pass.attack.latM ?? 0) >= WIDE_M,
            blockedSide: !settling && L.size >= 2 && blk.blocked && blk.beside ? blk.beside.side : null,
            blockedStep: !settling && L.size >= 2 && blk.blocked && !blk.beside ? this.stepFor(entries, me) : null,
            surface,
            tuck: tuck && {...tuck, race: this.raceFor(me) ?? null, drag: this.tuckDrag.result()},
            moveUp: climb && climb.state ? {state: climb.state, secs: climb.secs, priority: climb.priority, source: aheadFrom} : null,
            ahead: aheadFrom,
            nudge: nudge && nudge.state ? {state: nudge.state, priority: nudge.priority} : null,
            surfaceW, surfaceId: surface || null, surfaceAhead, pacing, bend, sCurve, feather, bridge: bridgeCall,
            burrito,
            teamHr: me.self && this.raceFor(me) === true ? this.teamHrWatch.update(entries, me, s.worldTime) : null,
            frc: frc ? {leftJ: frc.leftJ, frac: frc.frac, lowJ: frc.lowJ} : null,
            card: cardCall ? {about: cardCall.about, kind: cardCall.item ? cardCall.item.kind : null, plan: cardCall.plan || null,
                              power: cardCall.power || null, held: cardCall.held || null, note: cardCall.note || null, say: cardCall.say || null,
                              // a call that knows its own seconds (a standing start: you're stopped, so meters can't say)
                              inS: Number.isFinite(cardCall.inS) ? cardCall.inS :
                                  Number.isFinite(cardCall.toM) && cardCall.toM > 0 ? secsAlong(roadAhead, cardCall.toM, this.pace.vFlat ?? v) : null,
                              endS: Number.isFinite(cardCall.toEndM) && cardCall.toEndM > 0 ? secsAlong(roadAhead, cardCall.toEndM, this.pace.vFlat ?? v) : null,
                              priority: cardCall.priority, state: cardCall.state} : null,
            sprint: !(finish && finish.state) && inter && inter.state ? {state: inter.state, priority: inter.priority, held: null,
                toLineS: null, targetW: null, remainingM: line ? line.toLineM : null, intermediate: true} :
                finish && finish.state ? {state: finish.state, priority: finish.priority,
                held, toLineS: finish && finish.state ? toLineS : null, inS: Number.isFinite(finish.inS) ? finish.inS : null,
                targetW: this.sprintCoach.budget ? Math.round(this.sprintCoach.budget.targetW) : null,
                remainingM: Number.isFinite(me.remaining) ? me.remaining : null} : null,
            // the finish (calls.mjs FINALE_CALLS): 'run-in' (an event's last FINALE_M), 'sprint' (after your jump), 'done'
            // (past the line, still in the event), else null
            finale: !me.self || settling || finishType !== 'event' || me.remainingMetric !== 'distance' ||
                !Number.isFinite(me.remaining) ? null : me.remaining <= 0 ? 'done' : this.sprintCoach.jumped ? 'sprint' :
                me.remaining < FINALE_M ? 'run-in' : null,
            draftQ,
            cda: model.cda,
            cdaSource: model.source,
            groupSize: L.size,
            settling,
            draftless,
            // state codes for the data object (ds-data.mjs buildData; docs/DS-DATA.md)
            // before a climb your spot near the front is the plan: no "sit in" against "hold spot" (v0.60.1, 2026-11-07 1:13:14)
            positionState: offBack ? 'off-back' : pos.state === 'sit-in' && climb && climb.state ? 'good' : pos.state,
            demandW,
            throughKmh,
            demandFtpW: (me.self ? (this.fitnessFor(me) || {}).ftpW : null) || (me.athlete && me.athlete.ftp) || null,
            packState: settling ? 'settling' : packCostState(sit, L),
            holdingState: hold.state,
            cdaState: model.source === 'your CdA' ? 'yours' : model.hidden && model.hidden.length ? 'guessed' : 'model',
        };
        return {me, ds};
    }

    readPosition(s, spot, L, settling, power, noDraftWheel = false, gapping = null) {
        if (settling) {
            this.position.reset();
            return {w: null, note: SETTLING_NOTE, state: 'settling'};
        }
        // a gap opening ahead beats any advice about your own gap ("back off" while the wheel drifts off the group)
        if (gapping) {
            this.posQuietWt = s.worldTime;
            this.posGapOn = true;
            const w = this.position.update(s.worldTime, spot.positionW, spot.smoothed);
            if (gapping.which === 'bridge') {
                return {w: L.size < 2 ? null : w, state: 'bridging',
                        note: `bridging: ${gapping.riders} rider${gapping.riders === 1 ? '' : 's'} ${Math.round(gapping.aheadM)} m up the road, closing ${gapping.closeMps.toFixed(1)} m/s`};
            }
            if (gapping.which === 'drop') {
                return {w: L.size < 2 ? null : w, state: 'dropping',
                        note: `losing the group: ${Math.round(gapping.gapM)} m behind ${gapping.riders === 1 ? 'your wheel' : 'them'} and growing: close it now`};
            }
            if (gapping.which === 'shatter') {
                return {w: L.size < 2 ? null : w, state: 'shatter', note: 'group shattering: the riders ahead are splitting up. Do what you can: hold the front part, or the group you can'};
            }
            return {w: L.size < 2 ? null : w, state: 'gapping',
                    note: gapping.which === 'group' ? `gap opening: the riders ahead ride away (${gapping.mps.toFixed(1)} m/s): close up or go round` :
                        `gap opening ${gapping.which === 'wheel' ? 'in front of your wheel' : 'two wheels up'} (${Math.round(gapping.holeM)} m): close it or go round`};
        }
        if (noDraftWheel && L.size >= 2) {
            this.position.reset();
            return {w: null, note: NO_DRAFT_NOTE, state: 'no-draft'};
        }
        // Coasting (super tuck too): draft then only adds speed, it saves no pedaling watts, so there is nothing to show.
        // a fast descent (v0.60.1): the draft mostly adds speed there and your gap closes by itself; priced at speed
        // squared Position read 65–104 W "close up" at 50+ km/h with 150–177 W of draft (2026-11-07 30:25, 41:06)
        if (L.size >= 2 && (s.speed || 0) >= POSITION_DESCENT.kmh && (s.grade || 0) <= POSITION_DESCENT.grade) {
            this.position.reset();
            return {w: null, note: DESCENT_NOTE, state: 'coasting'};
        }
        if (L.size >= 2 && power < COAST_W) {
            this.position.reset();
            return {w: null, note: COASTING_NOTE, state: 'coasting'};
        }
        // just after a gap opening / shatter: Position starts over (its 10 s average still held the gap's cost: 2026-10-29,
        // steady at 3.2 m in a line of 5, 'hold a wheel' then 'back off' as 29 W ran down to 11) and gives no advice until
        // it has filled again
        if (this.posQuietWt != null) {
            if (this.posGapOn) {   // the first tick after it: your 10 s share and Position start over
                this.gapCurve.resetShare?.(this.athleteId);
                this.position.reset();
            }
            this.posGapOn = false;
            if (s.worldTime - this.posQuietWt < POSITION_TAU_S * 1000) {
                const w = this.position.update(s.worldTime, spot.positionW, spot.smoothed);
                return {w: L.size < 2 ? null : w, note: 'after the gap opening: reading your spot again', state: 'warming'};
            }
            this.posQuietWt = null;
        }
        const w = this.position.update(s.worldTime, spot.positionW, spot.smoothed);
        const wb = {...spot.best, lo: spot.best.lo - BIKE_LENGTH_M, hi: spot.best.hi - BIKE_LENGTH_M};   // wheel to wheel, as Gap
        const wL = L.gapAhead != null ? {...L, gapAhead: L.gapAhead - BIKE_LENGTH_M} : L;
        return {w: L.size < 2 ? null : w, note: positionAdvice(w, wb, wL, spot.boxed, undefined, spot.gapW),
                state: positionState(w, spot.best, L, spot.boxed, spot.gapW)};
    }

    /*
     * Holding is about keeping your place, so it is blank alone, and starts fresh when your group changes size class
     * (alone / with one rider / 3+), so a chase doesn't bleed into it. The steady need is air + rolling − Zwift's draft
     * + the pack cost of your spot + matching your group's speed (holding.mjs HoldingMeter).
     */
    readHolding(s, c, spot, L, v, packW, power, model, settling, blk) {
        const cls = Math.min(3, L.size);
        if (cls !== this.holdClass) {
            this.holdClass = cls;
            this.holding.reset();
        }
        if (settling) this.holding.reset();
        const w = this.holding.update({wt: s.worldTime, v, alt: s.altitude, power, massKg: model.massKg,
                                       steadyW: c.aero + c.roll - (s.draft || 0) + packW + spot.groupW +
                                           (L.size >= 3 ? foreAftW(v, L.vGroup) : 0),
                                       powerUp: s.activePowerUp || (settling ? 'TELEPORT' : null), coffee: s.coffeeStop},
                                      L.size >= 3 ? HOLD_PACK_S : HOLD_PAIR_S);
        if (settling) return {w: null, bandW: w.bandW, note: SETTLING_NOTE, state: 'settling'};
        if (L.size < 2) {
            this.motion.reset();
            return {w: null, bandW: w.bandW, note: ALONE_NOTE, state: 'alone'};
        }
        const hold = holdingW(w.wastedW, 0, power);
        const motion = this.motion.update(v, L.vGroup);
        const note = blk && blk.blocked ? blockedNote(blk) : motion;   // blocked says where the waste comes from
        const value = hold == null || !w.warmedUp ? null : hold;
        return {w: value, bandW: w.bandW, note: w.warmedUp ? note : 'filling the window…',
                state: holdingStateOf(value, w.bandW, !!(blk && blk.blocked), this.motion.rel)};
    }
}
