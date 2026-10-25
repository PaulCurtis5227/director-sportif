/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The meters as Sauce field definitions (pages/src/fields.mjs Renderer): the Grid shows any of them in any slot, and
 * a long press on a slot picks another. Each reads only `x.dsData`, the data object (ds-data.mjs, docs/DS-DATA.md):
 * the number as the value, the meter's word under it, the word's help in the tooltip. Watt meters read 0 with nothing
 * to read, the others blank. Pure (no Sauce imports) so the formatting is tested headless.
 */

import {wordOf, helpOf} from './ds-data.mjs';

export const FT_PER_M = 3.28084;
export const KMH_PER_MPH = 1.609344;

const num = (v, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : null);

/* Sideways offset in the chosen unit: "L 1.2" / "R 0.4" / "0.0" right behind the wheel. */
export function fmtSide(sideM, unit = 'ft') {
    if (!Number.isFinite(sideM)) return null;
    const k = unit === 'm' ? 1 : FT_PER_M;
    const d = Math.abs(sideM) * k;
    const digits = unit === 'm' ? 2 : 1;
    if (Number(d.toFixed(digits)) === 0) return (0).toFixed(digits);
    return `${sideM < 0 ? 'L' : 'R'} ${d.toFixed(digits)}`;
}

/*
 * The meter field group. options.sideUnit: 'ft' (default) or 'm'; options.imperial: Sauce's imperial switch (the gap
 * in ft, speeds in mph); options.current: () => the latest data object, for tooltips (Sauce calls a tooltip function
 * with the field, not the data).
 */
export function meterFields({sideUnit = 'ft', imperial = false, current = () => null} = {}) {
    const dist = m => (imperial ? m * FT_PER_M : m);
    const speed = kmh => (imperial ? kmh / KMH_PER_MPH : kmh);
    const m = (x, key) => (x && x.dsData && x.dsData.meters ? x.dsData.meters[key] || null : null);
    const word = key => x => {
        const e = m(x, key);
        return e ? wordOf(key, e.state) : '';
    };
    // the meter's description, then what its word means right now
    const tip = (key, about) => () => {
        const d = current();
        const e = d && d.meters ? d.meters[key] : null;
        const h = e ? helpOf(key, e.state) : '';
        return h ? `${about}\n\nNow: ${h}` : about;
    };
    const watts = (key, sign = false) => x => {
        const e = m(x, key);
        if (!e || !Number.isFinite(e.value)) return null;
        const v = Math.round(e.value);
        return `${sign && v > 0 ? '+' : ''}${v}`;
    };
    return [{
        id: 'ds-gap',
        shortName: 'Gap',
        longName: 'Gap to the wheel in front',
        tooltip: tip('gap', 'Meters to the rider in line in front of you, center to center (blank beyond 25 m). ' +
            '"~" = read from positions, which can be meters off.'),
        format: x => {
            const e = m(x, 'gap');
            const g = num(e && Number.isFinite(e.value) ? dist(e.value) : null, 1);
            return g == null ? null : `${e.approx ? '~' : ''}${g}`;
        },
        label: word('gap'),
        suffix: imperial ? 'ft' : 'm',
    }, {
        id: 'ds-side',
        shortName: 'L/R',
        longName: 'Left / right of the wheel in front',
        tooltip: tip('side', 'Where you sit sideways against the wheel in front (the one in line, else the nearest ' +
            'beside you).'),
        format: x => fmtSide(m(x, 'side')?.value, sideUnit),
        label: word('side'),
        suffix: sideUnit === 'm' ? 'm' : 'ft',
    }, {
        id: 'ds-pack',
        shortName: 'Pack cost',
        longName: "Pack cost: what your spot costs beyond Zwift's draft",
        tooltip: tip('pack', "Watts your spot in the bunch costs on top of what Zwift's draft says, read from where " +
            'you are now: gap to the wheel, riders close ahead, boxed in, your weight, tires and speed, the size of ' +
            'the bunch. The steady part only: getting blocked shows under Blocked and in Holding.'),
        format: watts('pack'),
        label: word('pack'),
        suffix: 'W',
    }, {
        id: 'ds-position',
        shortName: 'Position',
        longName: 'Position: what your spot costs against the best spot at your speed',
        tooltip: tip('position', 'Watts of draft your spot misses against the best spot at your speed, over 10 s (on a ' +
            'fast descent the best spot is 4–6 m back, not on the wheel). 0 alone or coasting.'),
        format: watts('position', true),
        label: word('position'),
        suffix: 'W',
    }, {
        id: 'ds-holding',
        shortName: 'Holding',
        longName: 'Holding: watts beyond what keeping your place needs',
        tooltip: tip('holding', "Your power minus what keeping your place needed (air, rolling, Zwift's draft, the " +
            'pack, matching your group, speed and height changes), over 10 s with one rider and 20 s in a group. ' +
            '± 20 W is holding.'),
        format: watts('holding', true),
        label: word('holding'),
        suffix: 'W',
    }, {
        id: 'ds-blocked',
        shortName: 'Blocked',
        longName: 'Blocked: watts lost pushing into the wheel ahead',
        tooltip: tip('blocked', 'Watts that went nowhere over the last 10 s because you pushed into the rider ahead ' +
            '(single seconds where 80+ W vanish). Easing off a little or steering to space saves them. Part of Holding.'),
        format: watts('blocked'),
        label: word('blocked'),
        suffix: 'W',
    }, {
        id: 'ds-pass',
        shortName: 'Passing',
        longName: 'Passing: closing on a rider at the speed that gets you held',
        tooltip: tip('passing', 'Closing on a rider 1–5 km/h faster gets you held up to one second in five (each ' +
            'held second costs the passer ~150 W and the rider in the way ~20 W); a pass at 5+ km/h goes through. ' +
            'The closing speed when you creep up on a rider (↑) or one creeps up on you (↓).'),
        format: x => {
            const e = m(x, 'passing');
            if (!e || !Number.isFinite(e.value)) return null;
            const defend = /^rider-/.test(e.state);
            return e.value > 0 ? `${defend ? '↓' : '↑'}${speed(e.value).toFixed(1)}` : '0';
        },
        label: word('passing'),
        suffix: imperial ? 'mph' : 'km/h',
    }, {
        id: 'ds-tuck',
        shortName: 'Tuck',
        longName: 'Supertuck: speed to go, or stop pedaling',
        tooltip: tip('tuck', 'Zwift tucks you at ~58 km/h (36 mph) or more, on −3% or steeper, under 11 W, out of ' +
            'the draft; not on a TT or MTB frame (Zwift Insider). On a descent: the speed still to go, 0 when you are ' +
            'fast enough. Your drag in the tuck vs coasting is in the data (this session).'),
        format: x => {
            const e = m(x, 'tuck');
            if (!e || !Number.isFinite(e.value)) return null;
            return e.value > 0 ? `+${speed(e.value).toFixed(1)}` : '0';
        },
        label: word('tuck'),
        suffix: imperial ? 'mph' : 'km/h',
    }, {
        id: 'ds-tuck-drag',
        shortName: 'Tuck drag',
        longName: 'Supertuck drag: your CdA in the tuck vs coasting, this session',
        // Advantage or bug (the user, 2026-10-16): a clearly negative % = the tuck cuts drag; ~0 over several tucks =
        // Zwift shows the tuck but the drag doesn't change (2026-10-16: −1% in one 7 s tuck).
        tooltip: () => {
            const d = current()?.meters?.tuck?.drag;
            const about = 'Your drag (CdA) in the supertuck against coasting at 40–58 km/h, measured from speed, ' +
                'height and power this session. Clearly below 0% = the tuck helps; about 0% = it doesn\'t.';
            return d && Number.isFinite(d.coast) ? `${about}\n\nTuck CdA ${d.tuck.toFixed(3)} (${Math.round(d.tuckS)} s) vs ` +
                `coasting ${d.coast.toFixed(3)} (${Math.round(d.coastS)} s).` : about;
        },
        format: x => {
            const d = m(x, 'tuck')?.drag;
            if (!d || !Number.isFinite(d.tuck) || !Number.isFinite(d.coast) || !(d.coast > 0)) return null;
            const pct = (d.tuck / d.coast - 1) * 100;
            return `${pct > 0.5 ? '+' : pct < -0.5 ? '−' : ''}${Math.abs(pct).toFixed(0)}`;
        },
        suffix: '%',
    }, {
        id: 'ds-cda',
        shortName: 'CdA',
        longName: 'CdA the meters use',
        tooltip: tip('cda', 'Air drag area the meters use: your bike type × your size from the Zwift profile, or the ' +
            'CdA you entered in settings.'),
        format: x => num(m(x, 'cda')?.value, 3),
        suffix: 'm²',
    }, {
        id: 'ds-surface',
        shortName: 'Surface',
        longName: 'Surface: what the road under you costs your tyres beyond pavement',
        tooltip: tip('surface', 'Watts the surface under you costs at your speed beyond pavement, on your tyres (road, ' +
            'gravel): Zwift\'s map and Zwift Insider\'s rolling resistance table. 0 on pavement.'),
        format: watts('surface'),
        label: word('surface'),
        suffix: 'W',
    }, {
        id: 'ds-frc',
        shortName: 'FRC',
        longName: 'FRC: your reserve above FTP',
        tooltip: tip('frc', 'kJ of your reserve above FTP left (FRC, W′), from your power: it drains above FTP and ' +
            'refills below it. Set your FTP and FRC in settings (WKO or similar).'),
        format: x => {
            const e = m(x, 'frc');
            return e && Number.isFinite(e.value) ? e.value.toFixed(1) : null;
        },
        label: word('frc'),
        suffix: 'kJ',
    }, {
        id: 'ds-demand',
        shortName: 'Demand',
        longName: 'Demand: the power the pack asks for',
        tooltip: tip('demand', 'The power the ideal spot needs to stay with your group, over 30 s (climbing and speeding up ' +
            'included): what the pack asks of anyone. Your power = this + Position (what your spot costs on top) + Holding ' +
            '(what you spent beyond that). % of your FTP in the note.'),
        format: x => {
            const e = m(x, 'demand');
            return e && Number.isFinite(e.value) ? e.value.toFixed(0) : null;
        },
        label: x => {
            const e = m(x, 'demand');
            return e && Number.isFinite(e.pctFtp) ? `${e.pctFtp}% FTP` : '';
        },
        suffix: 'W',
    }, {
        id: 'ds-group',
        shortName: 'Group',
        longName: 'Riders in your group',
        tooltip: 'Riders in your group (chained no more than 1 s apart), you included.',
        format: x => num(m(x, 'group')?.value),
        suffix: '',
    }, {
        id: 'ds-director',
        shortName: 'Director',
        longName: 'Director: the one thing to do now',
        tooltip: 'The most important call right now, the same words the voice says (blank when there is nothing).',
        format: x => {
            const c = x && x.dsData && x.dsData.call;
            if (!c) return null;
            const t = Number.isFinite(c.in) ? ` ${Math.round(c.in)} s` : '';
            const f = Number.isFinite(c.for) ? ` · ${Math.round(c.for)} s` : '';
            return `${c.word}${t}${f}`;
        },
        suffix: '',
    }];
}
