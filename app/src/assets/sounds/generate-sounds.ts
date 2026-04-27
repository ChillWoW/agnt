/**
 * One-off generator for the three notification sounds.
 *
 * Run with:
 *   cd app && bun run src/assets/sounds/generate-sounds.ts
 *
 * Style: "soft UI pop" — short filtered-noise bursts paired with tiny pitched
 * sine bodies. iOS / Linear / Arc-app vibe. Almost subliminal at the default
 * 0.25 playback volume; never melodic. Output is 16-bit mono PCM at 44.1 kHz.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SAMPLE_RATE = 44_100;

type NoiseLayer = {
    type: "noise";
    start: number; // seconds
    duration: number; // seconds
    amplitude: number; // 0..1
    /** One-pole lowpass cutoff in Hz. Omit to leave noise full-band. */
    lowpass?: number;
    /** One-pole highpass cutoff in Hz. Removes rumble for a tighter "tick". */
    highpass?: number;
    /** Exponential decay steepness across the layer's duration. */
    decay?: number;
    /** Short attack in seconds to avoid clicks. */
    attack?: number;
};

type ToneLayer = {
    type: "tone";
    start: number; // seconds
    duration: number; // seconds
    amplitude: number; // 0..1
    /** Starting frequency in Hz. */
    freqStart: number;
    /** Ending frequency in Hz. Linear sweep from freqStart -> freqEnd. */
    freqEnd?: number;
    decay?: number;
    attack?: number;
    /** 2nd-harmonic mix-in (0..1 relative to fundamental). */
    harmonic?: number;
};

type Layer = NoiseLayer | ToneLayer;

function onePoleLowpass(input: Float32Array, cutoff: number): Float32Array {
    const dt = 1 / SAMPLE_RATE;
    const rc = 1 / (2 * Math.PI * cutoff);
    const alpha = dt / (rc + dt);
    const out = new Float32Array(input.length);
    let y = 0;
    for (let i = 0; i < input.length; i++) {
        y = y + alpha * (input[i] - y);
        out[i] = y;
    }
    return out;
}

function onePoleHighpass(input: Float32Array, cutoff: number): Float32Array {
    const dt = 1 / SAMPLE_RATE;
    const rc = 1 / (2 * Math.PI * cutoff);
    const alpha = rc / (rc + dt);
    const out = new Float32Array(input.length);
    let yPrev = 0;
    let xPrev = 0;
    for (let i = 0; i < input.length; i++) {
        const x = input[i];
        const y = alpha * (yPrev + x - xPrev);
        out[i] = y;
        yPrev = y;
        xPrev = x;
    }
    return out;
}

function buildEnvelope(
    length: number,
    attackSec: number,
    decay: number
): Float32Array {
    const env = new Float32Array(length);
    const attackSamples = Math.max(1, Math.floor(attackSec * SAMPLE_RATE));
    for (let i = 0; i < length; i++) {
        const normalized = i / length;
        const decayEnv = Math.exp(-decay * normalized);
        const attackGain = i < attackSamples ? i / attackSamples : 1;
        env[i] = decayEnv * attackGain;
    }
    return env;
}

function renderLayers(layers: Layer[], totalSeconds: number): Int16Array {
    const total = Math.ceil(totalSeconds * SAMPLE_RATE);
    const buffer = new Float32Array(total);

    for (const layer of layers) {
        const startSample = Math.floor(layer.start * SAMPLE_RATE);
        const lengthSamples = Math.floor(layer.duration * SAMPLE_RATE);
        if (lengthSamples <= 0) continue;
        const env = buildEnvelope(
            lengthSamples,
            layer.attack ?? 0.003,
            layer.decay ?? 6
        );

        if (layer.type === "noise") {
            let noise = new Float32Array(lengthSamples);
            for (let i = 0; i < lengthSamples; i++) {
                noise[i] = Math.random() * 2 - 1;
            }
            if (layer.highpass !== undefined) {
                noise = onePoleHighpass(noise, layer.highpass);
            }
            if (layer.lowpass !== undefined) {
                noise = onePoleLowpass(noise, layer.lowpass);
            }
            for (let i = 0; i < lengthSamples; i++) {
                const idx = startSample + i;
                if (idx >= 0 && idx < total) {
                    buffer[idx] += noise[i] * env[i] * layer.amplitude;
                }
            }
            continue;
        }

        const freqEnd = layer.freqEnd ?? layer.freqStart;
        const harmonic = layer.harmonic ?? 0;
        let phase = 0;
        for (let i = 0; i < lengthSamples; i++) {
            const t = i / lengthSamples;
            const freq = layer.freqStart + (freqEnd - layer.freqStart) * t;
            phase += (2 * Math.PI * freq) / SAMPLE_RATE;
            const base = Math.sin(phase);
            const harm = harmonic > 0 ? Math.sin(phase * 2) * harmonic : 0;
            const sample = (base + harm) * env[i] * layer.amplitude;
            const idx = startSample + i;
            if (idx >= 0 && idx < total) buffer[idx] += sample;
        }
    }

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

// 1. Finish — single low warm "thunk". Soft impact noise + a warm 320 Hz
//    body with a subtle 2nd-harmonic for body. No pitch sweep. Feels like
//    setting something down on a desk: physical, settled, resolved. Lower
//    register than permission so the two sounds never blur together.
const finish = renderLayers(
    [
        {
            type: "noise",
            start: 0.0,
            duration: 0.03,
            amplitude: 0.4,
            highpass: 220,
            lowpass: 2000,
            attack: 0.001,
            decay: 14
        },
        {
            type: "tone",
            start: 0.002,
            duration: 0.34,
            amplitude: 0.44,
            freqStart: 320,
            attack: 0.006,
            decay: 4.4,
            harmonic: 0.18
        }
    ],
    0.46
);
writeWav(finish, resolve(import.meta.dir, "finish.wav"));

// 2. Permission — two quick soft taps, second slightly higher. iOS-style
//    "knock, knock" double tap. Tight bandpassed noise + tiny pitched body.
const permission = renderLayers(
    [
        {
            type: "noise",
            start: 0.0,
            duration: 0.05,
            amplitude: 0.42,
            highpass: 700,
            lowpass: 4000,
            attack: 0.001,
            decay: 11
        },
        {
            type: "tone",
            start: 0.0,
            duration: 0.07,
            amplitude: 0.3,
            freqStart: 720,
            attack: 0.002,
            decay: 16
        },
        {
            type: "noise",
            start: 0.11,
            duration: 0.05,
            amplitude: 0.44,
            highpass: 800,
            lowpass: 4500,
            attack: 0.001,
            decay: 11
        },
        {
            type: "tone",
            start: 0.11,
            duration: 0.08,
            amplitude: 0.32,
            freqStart: 920,
            attack: 0.002,
            decay: 14
        }
    ],
    0.32
);
writeWav(permission, resolve(import.meta.dir, "permission.wav"));

// 3. Question — clean mid "ping" with shimmer. Single 880 Hz body plus a
//    very quiet 2640 Hz (3rd harmonic) layer that adds a glass-like sparkle.
//    No noise burst, no pitch sweep — a single note, not a melody, so it
//    doesn't read as musical. Higher register than permission/finish.
const question = renderLayers(
    [
        {
            type: "tone",
            start: 0.0,
            duration: 0.18,
            amplitude: 0.34,
            freqStart: 880,
            attack: 0.004,
            decay: 6.5,
            harmonic: 0.12
        },
        {
            type: "tone",
            start: 0.0,
            duration: 0.18,
            amplitude: 0.06,
            freqStart: 2640,
            attack: 0.008,
            decay: 9
        }
    ],
    0.24
);
writeWav(question, resolve(import.meta.dir, "question.wav"));

console.log("Generated finish.wav, permission.wav, question.wav (soft UI pop)");
