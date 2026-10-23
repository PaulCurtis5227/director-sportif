/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Road surfaces, with Zwift Insider's rolling-resistance table (https://zwiftinsider.com/crr/,
 * updated 2026-09-17) per tyre type. First real ride measured cobbles ≈ .011 on road tyres (table
 * says .0065) — these are starting points, not truth. (Moved out of recording.mjs so the Director
 * Sportif mod can carry it with road-map.mjs.)
 */
export const SURFACES = [
    {id: 'pavement', label: 'Pavement', crr: {road: 0.004, gravel: 0.008, mtb: 0.009}},
    {id: 'wood', label: 'Wood', crr: {road: 0.0065, gravel: 0.008, mtb: 0.009}},
    {id: 'brick', label: 'Brick', crr: {road: 0.0055, gravel: 0.008, mtb: 0.009}},
    {id: 'cobbles', label: 'Cobbles', crr: {road: 0.0065, gravel: 0.008, mtb: 0.009}},
    {id: 'dirt', label: 'Dirt', crr: {road: 0.016, gravel: 0.009, mtb: 0.01}},
    {id: 'gravel', label: 'Gravel', crr: {road: 0.012, gravel: 0.009, mtb: 0.009}},
    {id: 'grass', label: 'Grass', crr: {road: 0.025, gravel: 0.016, mtb: 0.014}},
    {id: 'sand', label: 'Sand', crr: {road: 0.004, gravel: 0.008, mtb: 0.009}},
    {id: 'snow', label: 'Ice / snow', crr: {road: 0.0055, gravel: 0.006, mtb: 0.014}},
];
