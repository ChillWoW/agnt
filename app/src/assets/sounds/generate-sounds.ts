/**
 * One-off generator for the three notification sounds.
 *
 * Run with:
 *   cd app && bun run src/assets/sounds/generate-sounds.ts
 *
 * This produces finish.wav, permission.wav, question.wav as 16-bit mono PCM
 * at 44.1 kHz. Kept in the repo so the sounds are reproducible and tweakable
 * without pulling in a binary asset from the internet.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SAMPLE_RATE = 44_100;

type Tone = {
    freq: number;
    start: number; // seconds
    duration: number; // seconds
    amplitude: number; // 0..1
    /** Adds 2nd harmonic at this relative amplitude (0..1). */
    harmonic?: number;
    /** Exponential decay steepness; higher = faster fade. */
    decay?: number;
    /** Short attack in seconds to avoid click. */
    attack?: number;
};

function renderTones(tones: Tone[], totalSeconds: number): Int16Array {
    const total = Math.ceil(totalSeconds * SAMPLE_RATE);
    const buffer = new Float32Array(total);

    for (const tone of tones) {
        const startSample = Math.floor(tone.start * SAMPLE_RATE);
        const lengthSamples = Math.floor(tone.duration * SAMPLE_RATE);
        const decay = tone.decay ?? 4;
        const attack = tone.attack ?? 0.005;
        const attackSamples = Math.floor(attack * SAMPLE_RATE);
        const harmonic = tone.harmonic ?? 0;

        for (let i = 0; i < lengthSamples; i++) {
            const t = i / SAMPLE_RATE;
            const normalized = i / lengthSamples;
            const env = Math.exp(-decay * normalized);
            const attackGain =
                attackSamples > 0 && i < attackSamples ? i / attackSamples : 1;
            const base = Math.sin(2 * Math.PI * tone.freq * t);
            const harm =
                harmonic > 0
                    ? Math.sin(2 * Math.PI * tone.freq * 2 * t) * harmonic
                    : 0;
            const sample = (base + harm) * env * attackGain * tone.amplitude;
            const idx = startSample + i;
            if (idx >= 0 && idx < total) buffer[idx] += sample;
        }
    }

    // soft clipping to avoid hard clipping artifacts at mix overlaps
    const out = new Int16Array(total);
    for (let i = 0; i < total; i++) {
        let s = buffer[i];
        if (s > 1) s = 1;
        if (s < -1) s = -1;
        out[i] = Math.round(s * 0x7fff);
    }
    return out;
}

function writeWav(samples: Int16Array, filePath: string): void {
    const byteLength = samples.length * 2;
    const buffer = Buffer.alloc(44 + byteLength);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + byteLength, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write("data", 36);
    buffer.writeUInt32LE(byteLength, 40);
    for (let i = 0; i < samples.length; i++) {
        buffer.writeInt16LE(samples[i], 44 + i * 2);
    }

    writeFileSync(filePath, buffer);
}

// Notes in Hz.
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880.0;
const B5 = 987.77;
const C6 = 1046.5;
const E6 = 1318.51;

// 1. Finish — soft two-note chime C5 -> E5 -> G5 (pleasant ascending arpeggio).
const finish = renderTones(
    [
        { freq: C5, start: 0.0, duration: 0.7, amplitude: 0.35, harmonic: 0.15, decay: 3 },
        { freq: E5, start: 0.09, duration: 0.7, amplitude: 0.35, harmonic: 0.15, decay: 3 },
        { freq: G5, start: 0.18, duration: 0.8, amplitude: 0.4, harmonic: 0.15, decay: 2.5 }
    ],
    1.1
);
writeWav(finish, resolve(import.meta.dir, "finish.wav"));

// 2. Permission — two-pulse attention ping. Higher pitch, tighter decay.
const permission = renderTones(
    [
        { freq: A5, start: 0.0, duration: 0.18, amplitude: 0.5, harmonic: 0.2, decay: 6 },
        { freq: E6, start: 0.22, duration: 0.35, amplitude: 0.55, harmonic: 0.2, decay: 5 }
    ],
    0.7
);
writeWav(permission, resolve(import.meta.dir, "permission.wav"));

// 3. Question — light melodic pop. Single note with sparkle harmonic.
const question = renderTones(
    [
        { freq: B5, start: 0.0, duration: 0.25, amplitude: 0.4, harmonic: 0.25, decay: 8 },
        { freq: C6, start: 0.06, duration: 0.45, amplitude: 0.3, harmonic: 0.2, decay: 5 }
    ],
    0.6
);
writeWav(question, resolve(import.meta.dir, "question.wav"));

console.log("Generated finish.wav, permission.wav, question.wav");
