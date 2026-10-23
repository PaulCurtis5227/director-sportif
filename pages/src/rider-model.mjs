/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The simple rider model: CdA = the bike type's base × the wheel depth × aero socks × your size, from the Zwift
 * profile. The exact frame within a type moves CdA ±2–5%, your size ±17% (the profile has it). Wheels and socks are
 * asked for because Holding takes them as a steady bias, ~2 W per 1% of CdA: an SL9 on a disc with socks read 11 W low
 * as a plain "aero road bike" (2026-10-10 races; Position moved < 5 W). Riders who know their real CdA (the website
 * report fits it from an uploaded ride) type it in instead.
 *
 * Bases: Zwift Insider's speed-test sheet as solved by the Efficiency Meter (analysis/equipment.mjs), top frame stage
 * with Zwift's stock 32 mm carbon wheels, for the sheet's 183 cm / 75 kg rider: road frames 0.298–0.330 (middle half
 * 0.299–0.312), aero road (Tarmac SL8, Aeroad 2024, Venge) ~0.298, halo (PROJECT 74, R4000) ~0.283, Pinarello Espada
 * 0.254, TT median 0.264, gravel median 0.306 (rolling ~2x on pavement). Size scaling ∝ height^0.65 · weight^0.44.
 * Wheels against the stock 32 mm carbon on the same frame (the sheet's 72 road wheels on the Zwift Carbon): mid depth
 * (Zipp 404, Roval Rapide CLX, CADEX 50) −2.3%, deep (DT ARC 1100 62/65, Zipp 808, Reserve 57/64) −3.5%, disc or the
 * deepest (Reserve Infinity, Zipp 858/Super9, ENVE 8.9, DURA-ACE C99) −4.2%. Aero Lightning socks −1.0%. TT and gravel
 * wheels follow their own tables; the road factors stand in for them.
 */

export const REF_HEIGHT_CM = 183;
export const REF_WEIGHT_KG = 75;
export const HEIGHT_EXP = 0.65;
export const WEIGHT_EXP = 0.44;
export const BIKE_KG = 5;            // frame + wheels (group-ride fits: profile weight + 5.0 kg)
export const FALLBACK_HEIGHT_CM = 178;
export const FALLBACK_WEIGHT_KG = 75;
export const MY_CDA_RANGE = [0.15, 0.6];

export const BIKES = [
    {id: 'road', label: 'Road bike', cda: 0.312, crr: 0.0045},
    {id: 'aero', label: 'Aero road bike (Tarmac SL8, Aeroad, Venge…)', cda: 0.298, crr: 0.0045},
    {id: 'halo', label: 'Halo: PROJECT 74, R4000', cda: 0.283, crr: 0.0044},
    {id: 'espada', label: 'Halo: Pinarello Espada', cda: 0.254, crr: 0.0043},
    {id: 'tt', label: 'TT bike', cda: 0.264, crr: 0.0046},
    {id: 'gravel', label: 'Gravel bike', cda: 0.306, crr: 0.0086, tyre: 'gravel'},
];
export const DEFAULT_BIKE = 'road';

export const WHEELS = [
    {id: 'stock', label: 'Stock or shallow (Zwift 32 mm, Zipp 202)', short: 'stock wheels', factor: 1},
    {id: 'mid', label: 'Mid depth (Zipp 404, Roval Rapide CLX, CADEX 50)', short: 'mid wheels', factor: 0.977},
    {id: 'deep', label: 'Deep (DT Swiss ARC 62/65, Zipp 808, Reserve 57/64)', short: 'deep wheels', factor: 0.965},
    {id: 'disc', label: 'Disc or deepest (Reserve Infinity, Zipp 858/Super9, ENVE 8.9)', short: 'disc', factor: 0.958},
];
export const DEFAULT_WHEELS = 'stock';
export const AERO_SOCKS_FACTOR = 0.9896;

/* Size factor against the reference rider: ×0.80 at 160 cm / 55 kg, ×1.14 at 190 cm / 95 kg. */
export function sizeFactor(heightCm, weightKg) {
    return (heightCm / REF_HEIGHT_CM) ** HEIGHT_EXP * (weightKg / REF_WEIGHT_KG) ** WEIGHT_EXP;
}

/*
 * {cda, crr, massKg, source, hidden}. athlete = Sauce's athlete profile ({height, weight}; minors have no height);
 * bike = a BIKES id; wheels = a WHEELS id; socks = aero socks on; myCda = the rider's own CdA (used when in
 * MY_CDA_RANGE, replacing bike, wheels and socks). crr is the bike type's pavement value; tyre ('road' | 'gravel')
 * picks the row of the surface table (engine/surfaces.mjs) the meter engine adds for dirt, wood, brick… from Zwift's map.
 */
export function riderModel({athlete = {}, bike = DEFAULT_BIKE, wheels = DEFAULT_WHEELS, socks = false,
                            myCda = null} = {}) {
    const b = BIKES.find(x => x.id === bike) || BIKES.find(x => x.id === DEFAULT_BIKE);
    const w = WHEELS.find(x => x.id === wheels) || WHEELS.find(x => x.id === DEFAULT_WHEELS);
    const heightCm = athlete.height > 0 ? athlete.height : FALLBACK_HEIGHT_CM;
    const weightKg = athlete.weight > 0 ? athlete.weight : FALLBACK_WEIGHT_KG;
    const hidden = [!(athlete.height > 0) && 'height', !(athlete.weight > 0) && 'weight'].filter(Boolean);
    const own = Number(myCda);
    const useOwn = myCda !== null && myCda !== '' && Number.isFinite(own) &&
        own >= MY_CDA_RANGE[0] && own <= MY_CDA_RANGE[1];
    const cda = useOwn ? own : b.cda * w.factor * (socks ? AERO_SOCKS_FACTOR : 1) * sizeFactor(heightCm, weightKg);
    const setup = [b.label.split(' (')[0].replace(/^Halo: /, ''), w.short, socks && 'socks'].filter(Boolean).join(', ');
    const source = useOwn ? 'your CdA' :
        `${setup} × your size${hidden.length ? ` (${hidden.join(' and ')} hidden: guessed)` : ''}`;
    return {cda, crr: b.crr, tyre: b.tyre || 'road', massKg: weightKg + BIKE_KG, source, hidden, bike: b.id, wheels: w.id, socks: !!socks};
}
