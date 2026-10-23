/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Title card for Broadcast: the video opens on a page with the race (event, route, the race card's course facts)
 * and a note on where to get the Director Sportif (caffecter.com), then cuts to your normal OBS scene. The page (title.html) is served by
 * Sauce's web server, so OBS shows it as a Browser source; the mod creates that scene and source itself the first
 * time (obs-websocket v5: CreateScene / CreateInput), points it at this race, switches to it before StartRecord and
 * back to the scene you were on after TITLE_S. Your plan for the card is shown too (the user: the video is of the race
 * that carries it out); the OBS browser can't read Sauce's settings, so it travels in the URL. Only what you set is
 * shown, not the defaults.
 * The Director Sportif shows the same card from its own copy (synced to its engine/, v0.28.0) in its own scene: the
 * OBS calls take {scene, input} (default: the Efficiency Meter's).
 */

import {itemKey} from './race-card.mjs';

export const TITLE_CHOICES_S = [0, 10, 15, 20, 30];   // 0 = no title card
export const DEFAULT_TITLE_S = 15;
export const TITLE_SCENE = 'Efficiency Meter: title';
export const TITLE_INPUT = 'Efficiency Meter title card';
export const TITLE_PATH = '/mods/efficiency-meter/pages/title.html';

const PU = {AERO: 'Aero', DRAFTBOOST: 'Draft van', VAN: 'Draft van', LIGHTNESS: 'Feather', FEATHER: 'Feather',
            NINJA: 'Ghost', UNDRAFTABLE: 'Burrito', BOOST: 'Arrows', RANDOM: 'Random', XP: 'XP'};
const KIND = {sprint: 'Sprint', kom: 'KOM', climb: 'Climb', arch: 'Arch', finish: 'Finish'};

/* The query string for title.html. Everything optional. */
export function titleQuery({cardId, eventName, subgroup, startMs, rider, plan} = {}) {
    const q = new URLSearchParams();
    if (cardId) q.set('card', cardId);
    if (eventName) q.set('event', eventName);
    if (subgroup) q.set('cat', subgroup);
    if (Number.isFinite(startMs)) q.set('start', String(Math.round(startMs)));
    if (rider) q.set('rider', rider);
    if (plan && Object.keys(plan).length) q.set('plan', JSON.stringify(plan));
    return q.toString();
}

export function parseTitleQuery(search) {
    const q = new URLSearchParams(search);
    const start = Number(q.get('start'));
    let plan = {};
    try {
        const p = JSON.parse(q.get('plan') || '{}');
        if (p && typeof p === 'object') plan = p;
    } catch (e) { /* bad plan: show none */ }
    return {cardId: q.get('card') || null, eventName: q.get('event') || null, subgroup: q.get('cat') || null,
            startMs: q.get('start') && Number.isFinite(start) ? start : null, rider: q.get('rider') || null, plan};
}

const PLAN = {contest: 'Contest', position: 'Position for it', skip: 'Skip'};
const POWER = {use: 'Use the power-up', keep: 'Keep the power-up'};

/* Display rows from a race card, with what the rider planned for each item (only what they set). */
export function cardRows(card, plan = {}) {
    if (!card || !Array.isArray(card.items)) return [];
    return card.items.map(it => {
        const detail = [];
        if (Number.isFinite(it.lengthKm)) detail.push(`${it.lengthKm} km`);
        if (Number.isFinite(it.grade) && it.grade > 0) detail.push(`${(it.grade * 100).toFixed(1)}%`);
        if (it.scored) detail.push('scored');
        const p = plan[itemKey(it)] || {};
        const mine = [PLAN[p.plan], POWER[p.power], p.note].filter(Boolean).join(' · ');
        return {km: it.km == null ? '' : `${it.km} km`, kind: KIND[it.kind] || it.kind, kindId: it.kind, name: it.name,
                detail: detail.join(' · '), gives: it.gives ? (PU[it.gives] || it.gives) : '', plan: mine};
    });
}

/* The scene and Browser source exist and show `url`, sized to the OBS canvas. */
export async function prepareTitle(obs, url, {scene = TITLE_SCENE, input = TITLE_INPUT} = {}) {
    const video = await obs.call('GetVideoSettings').catch(() => ({}));
    const width = video.baseWidth || 1920, height = video.baseHeight || 1080;
    const scenes = await obs.call('GetSceneList');
    if (!(scenes.scenes || []).some(s => s.sceneName === scene)) {
        await obs.call('CreateScene', {sceneName: scene});
    }
    const settings = {url, width, height, reroute_audio: false, shutdown: false};
    const exists = await obs.call('GetInputSettings', {inputName: input}).then(() => true, () => false);
    if (exists) {
        await obs.call('SetInputSettings', {inputName: input, inputSettings: settings, overlay: true});
        await obs.call('PressInputPropertiesButton', {inputName: input, propertyName: 'refreshnocache'}).catch(() => null);
    } else {
        await obs.call('CreateInput', {sceneName: scene, inputName: input, inputKind: 'browser_source',
                                       inputSettings: settings, sceneItemEnabled: true});
    }
}

/* Switch to the title scene; returns the scene to come back to (null if already on it). */
export async function showTitle(obs, {scene = TITLE_SCENE} = {}) {
    const cur = await obs.call('GetCurrentProgramScene');
    const back = cur.currentProgramSceneName || cur.sceneName || null;
    if (back === scene) return null;
    await obs.call('SetCurrentProgramScene', {sceneName: scene});
    return back;
}

/* Back to `back`, unless you switched scenes yourself in the meantime. */
export async function hideTitle(obs, back, {scene = TITLE_SCENE} = {}) {
    if (!back) return false;
    const cur = await obs.call('GetCurrentProgramScene');
    if ((cur.currentProgramSceneName || cur.sceneName) !== scene) return false;
    await obs.call('SetCurrentProgramScene', {sceneName: back});
    return true;
}
