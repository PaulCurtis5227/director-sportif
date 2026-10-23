/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spoken calls: the director's call read out (Chromium's built-in text-to-speech, window.speechSynthesis), so the
 * rider hears "Move up now, along the edge" instead of reading a line mid-effort. Off by default ("Voice" switch).
 *
 * A short two-tone chime goes first (on by default): browser speech is already at full volume and was hard to hear
 * over music (the user, 2026-10-03), and a bright chime cuts through where a voice doesn't, so you know to listen.
 * Web Audio (an oscillator), no sound files.
 */

export const MIN_GAP_S = 6;    // never talk over yourself: at least this long between calls
export const RATES = [0.9, 1.0, 1.05, 1.15, 1.3];
export const DEFAULT_RATE = 1.05;
export const CHIME = {tones: [880, 1320], toneMs: 140, gapMs: 30, gain: 0.8, speakAfterMs: 380};

/* Play the chime (tones: Hz, one after another) on an AudioContext; returns how long it takes (ms). */
export function playChime(ctx, tones = CHIME.tones) {
    const t0 = ctx.currentTime + 0.01;
    tones.forEach((hz, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        const start = t0 + i * (CHIME.toneMs + CHIME.gapMs) / 1000, end = start + CHIME.toneMs / 1000;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(CHIME.gain, start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, end);
        osc.connect(g).connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.02);
    });
    return tones.length * (CHIME.toneMs + CHIME.gapMs);
}

/* Turn a screen line into something that reads well aloud. */
export function speechText(text) {
    return String(text || '')
        .replace(/~(?=\d)/g, 'about ')
        .replace(/\+(\d+(?:\.\d+)?) km\/h/g, '$1 kilometers an hour faster')
        .replace(/\+(\d+(?:\.\d+)?) mph/g, '$1 miles an hour faster')
        .replace(/(\d+(?:\.\d+)?)\+? km\/h/g, '$1 kilometers an hour')
        .replace(/(\d+(?:\.\d+)?)\+? mph/g, '$1 miles an hour')
        .replace(/\+(\d+)[–-](\d+) W/g, '$1 to $2 watts more')
        .replace(/(\d+) W\b/g, '$1 watts')
        .replace(/(\d+) s\b/g, '$1 seconds')
        .replace(/(\d+) m at (\d+)%/g, '$1 meters at $2 percent')
        // the screen's "400 m" / "1.2 km" read as words (the voice said "400 m", 2026-10-08)
        .replace(/(\d+(?:\.\d+)?) km\b/g, '$1 kilometers')
        .replace(/(\d+(?:\.\d+)?) m\b/g, '$1 meters')
        .replace(/(\d+(?:\.\d+)?) ft\b/g, '$1 feet')
        .replace(/(\d+(?:\.\d+)?)%/g, '$1 percent')
        .replace(/\s+—\s+/g, ', ')
        .replace(/\s*\(\s*/g, ', ')
        .replace(/\s*\)/g, '')
        .replace(/\bMOVE UP NOW\b/g, 'Move up now')
        .replace(/\s*,\s*,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/[ ,]+$/, '')
        .trim();
}

/*
 * Says each new call once: a call is new when its id|state changes; repeats of the same call (its countdown ticking)
 * stay quiet. synth defaults to window.speechSynthesis; missing = silently does nothing.
 */
export class Speaker {
    constructor({synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, minGapS = MIN_GAP_S,
                 AudioCtx = globalThis.AudioContext, later = (fn, ms) => setTimeout(fn, ms)} = {}) {
        this.synth = synth;
        this.AudioCtx = AudioCtx;
        this.later = later;
        this.ctx = null;
        this.chime = true;
        this.Utterance = Utterance;
        this.minGapMs = minGapS * 1000;
        this.lastKey = null;
        this.lastTs = -Infinity;
        this.voiceName = '';     // '' = Windows' default voice
        this.rate = DEFAULT_RATE;
    }

    /* The voices Windows offers to Chromium: [{name, lang}] (may be empty until the browser has loaded them). */
    voices() {
        try {
            return this.synth && this.synth.getVoices ? this.synth.getVoices().map(v => ({name: v.name, lang: v.lang})) : [];
        } catch (e) {
            return [];
        }
    }

    configure({voiceName, rate, chime} = {}) {
        if (chime != null) this.chime = chime === true || chime === 'true';
        if (voiceName != null) this.voiceName = String(voiceName);
        if (Number(rate) > 0) this.rate = Number(rate);
    }

    /* Speak now, ignoring the call bookkeeping (the "try this voice" sample). */
    sample(text = 'Move up now, along the edge. Climb in 60 seconds.') {
        return this.utter(text);
    }

    /* Just the chime (tones: Hz); true when it played. */
    ding(tones = CHIME.tones) {
        if (!this.AudioCtx) return false;
        try {
            this.ctx ||= new this.AudioCtx();
            if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
            playChime(this.ctx, tones);
            return true;
        } catch (e) {
            console.warn('chime failed', e);
            return false;
        }
    }

    /*
     * The chime, then the words. Returns the text (spoken now or right after the chime), or null. chime / tones
     * override the configured chime for this call (a call type with its own sound, or one without a chime).
     */
    utter(text, {chime = this.chime, tones = CHIME.tones} = {}) {
        if (!this.available) return null;
        const wait = chime && this.ding(tones) ? CHIME.speakAfterMs : 0;
        if (wait > 0) {
            this.later(() => this.speakNow(text), wait);
            return text;
        }
        return this.speakNow(text);
    }

    speakNow(text) {
        try {
            this.synth.cancel();
            const u = new this.Utterance(text);
            u.rate = this.rate;
            if (this.voiceName && this.synth.getVoices) {
                const v = this.synth.getVoices().find(x => x.name === this.voiceName);
                if (v) u.voice = v;
            }
            this.synth.speak(u);
            return text;
        } catch (e) {
            console.warn('speech failed', e);
            return null;
        }
    }

    get available() {
        return !!(this.synth && this.Utterance);
    }

    /* call: {id, state, text}; returns the text spoken, or null. */
    say(call, ts = Date.now()) {
        if (!call || !call.state || !call.text) {
            this.lastKey = null;    // the call ended: the next one is new, even if it's the same kind
            return null;
        }
        const key = `${call.id}|${call.state}`;
        if (key === this.lastKey || ts - this.lastTs < this.minGapMs || !this.available) {
            return null;
        }
        this.lastKey = key;
        this.lastTs = ts;
        return this.utter(speechText(call.text));
    }
}
