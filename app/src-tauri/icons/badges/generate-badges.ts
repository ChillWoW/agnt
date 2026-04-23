/**
 * One-off generator for Windows taskbar overlay badge icons.
 *
 * Run with:
 *   bun run app/src-tauri/icons/badges/generate-badges.ts
 *
 * Produces 1.png .. 9.png + 9plus.png as 32x32 RGBA PNGs: a red filled
 * circle with a white bold numeral centered inside. The files are tiny
 * (~0.5 KB each) and kept in the repo so the assets are reproducible.
 *
 * Implementation notes:
 *   - Pure Bun/Node, no external deps. PNG encoding is done by hand using
 *     node:zlib for the DEFLATE stream.
 *   - Glyphs are a hand-tuned 5x7 bitmap font, upscaled 3x so the final
 *     stroke weight is legible at Windows taskbar overlay size (16x16/24x24).
 *   - "9plus" renders as "9+" using the same font scaled down a touch so it
 *     fits inside the circle.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SIZE = 32;

// Pulled from the app's Tailwind palette (see app/src/index.css):
//   BG     = primary-900 (#1f2937)  — dark slate, on-palette
//   RING   = primary-600 (#6b7280)  — subtle lighter border so the badge
//            doesn't blend into a dark Windows taskbar
//   FG     = primary-200 (#f3f4f6)  — near-white numeral for contrast
const BG: [number, number, number, number] = [31, 41, 55, 255];
const RING: [number, number, number, number] = [107, 114, 128, 255];
const FG: [number, number, number, number] = [243, 244, 246, 255];
const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];

// 5x7 bitmap font for the digits we need.
// Each row is 5 bits, top to bottom. Bit 4 = leftmost pixel.
const FONT_5x7: Record<string, number[]> = {
    "1": [
        0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110
    ],
    "2": [
        0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111
    ],
    "3": [
        0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110
    ],
    "4": [
        0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010
    ],
    "5": [
        0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110
    ],
    "6": [
        0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110
    ],
    "7": [
        0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000
    ],
    "8": [
        0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110
    ],
    "9": [
        0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100
    ],
    "+": [
        0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000
    ]
};

type Rgba = [number, number, number, number];

function createImage(size: number): Uint8Array {
    const buf = new Uint8Array(size * size * 4);
    // Default: transparent.
    for (let i = 3; i < buf.length; i += 4) buf[i] = 0;
    return buf;
}

function setPixel(
    img: Uint8Array,
    size: number,
    x: number,
    y: number,
    color: Rgba
): void {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const idx = (y * size + x) * 4;
    img[idx + 0] = color[0];
    img[idx + 1] = color[1];
    img[idx + 2] = color[2];
    img[idx + 3] = color[3];
}

function drawFilledCircle(
    img: Uint8Array,
    size: number,
    cx: number,
    cy: number,
    radius: number,
    color: Rgba,
    mode: "paintOverTransparent" | "overwrite" = "paintOverTransparent"
): void {
    const r2 = radius * radius;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - cx + 0.5;
            const dy = y - cy + 0.5;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            // Soft edge: alpha-ramp the last ~1 px.
            const d = Math.sqrt(d2);
            const edgeDist = radius - d;
            const alpha = edgeDist >= 1 ? 1 : Math.max(0, edgeDist);
            const a = Math.round(color[3] * alpha);
            const idx = (y * size + x) * 4;
            if (mode === "paintOverTransparent") {
                const curA = img[idx + 3];
                if (a <= curA) continue;
            }
            img[idx + 0] = color[0];
            img[idx + 1] = color[1];
            img[idx + 2] = color[2];
            img[idx + 3] = a;
        }
    }
}

function drawGlyph(
    img: Uint8Array,
    size: number,
    glyph: number[],
    x: number,
    y: number,
    scale: number,
    color: Rgba
): void {
    for (let row = 0; row < glyph.length; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 5; col++) {
            if (bits & (1 << (4 - col))) {
                for (let dy = 0; dy < scale; dy++) {
                    for (let dx = 0; dx < scale; dx++) {
                        setPixel(
                            img,
                            size,
                            x + col * scale + dx,
                            y + row * scale + dy,
                            color
                        );
                    }
                }
            }
        }
    }
}

function drawText(
    img: Uint8Array,
    size: number,
    text: string,
    scale: number,
    color: Rgba
): void {
    const glyphs = [...text].map((ch) => FONT_5x7[ch] ?? FONT_5x7["1"]);
    const glyphW = 5 * scale;
    const glyphH = 7 * scale;
    const spacing = Math.max(1, Math.floor(scale * 0.5));
    const totalW = glyphs.length * glyphW + (glyphs.length - 1) * spacing;
    const startX = Math.floor((size - totalW) / 2);
    const startY = Math.floor((size - glyphH) / 2);
    let x = startX;
    for (const g of glyphs) {
        drawGlyph(img, size, g, x, startY, scale, color);
        x += glyphW + spacing;
    }
}

// --- Minimal PNG encoder (RGBA8) ---

function crc32(data: Uint8Array): number {
    // Precomputed CRC32 table via formula (slow but fine for tiny icons).
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let k = 0; k < 8; k++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + data.length + 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out[4] = type.charCodeAt(0);
    out[5] = type.charCodeAt(1);
    out[6] = type.charCodeAt(2);
    out[7] = type.charCodeAt(3);
    out.set(data, 8);
    const crcInput = new Uint8Array(4 + data.length);
    crcInput[0] = out[4];
    crcInput[1] = out[5];
    crcInput[2] = out[6];
    crcInput[3] = out[7];
    crcInput.set(data, 4);
    view.setUint32(8 + data.length, crc32(crcInput));
    return out;
}

function encodePng(rgba: Uint8Array, size: number): Uint8Array {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, size);
    ihdrView.setUint32(4, size);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // Prepend filter byte 0 to each scanline.
    const filtered = new Uint8Array(size * (1 + size * 4));
    for (let y = 0; y < size; y++) {
        const dstRow = y * (1 + size * 4);
        filtered[dstRow] = 0;
        filtered.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), dstRow + 1);
    }
    const idatData = new Uint8Array(deflateSync(Buffer.from(filtered)));

    const chunks = [
        signature,
        chunk("IHDR", ihdr),
        chunk("IDAT", idatData),
        chunk("IEND", new Uint8Array(0))
    ];
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

// --- Render each badge ---

function renderBadge(text: string, scale: number): Uint8Array {
    const img = createImage(SIZE);
    // Ring first (outer circle), then overwrite the inner region with the
    // darker fill so the ring ends up as a 1.5 px hairline.
    drawFilledCircle(img, SIZE, SIZE / 2, SIZE / 2, SIZE / 2 - 0.5, RING);
    drawFilledCircle(
        img,
        SIZE,
        SIZE / 2,
        SIZE / 2,
        SIZE / 2 - 2,
        BG,
        "overwrite"
    );
    drawText(img, SIZE, text, scale, FG);
    return img;
}

const OUT_DIR = import.meta.dir;

for (let n = 1; n <= 9; n++) {
    const img = renderBadge(String(n), 3);
    const png = encodePng(img, SIZE);
    writeFileSync(resolve(OUT_DIR, `${n}.png`), png);
}

// "9+" uses slightly smaller glyphs so it fits side-by-side inside the circle.
{
    const img = renderBadge("9+", 2);
    const png = encodePng(img, SIZE);
    writeFileSync(resolve(OUT_DIR, "9plus.png"), png);
}

console.log(`Wrote 10 badge PNGs to ${OUT_DIR}`);

// Silence unused warnings for TRANSPARENT (kept intentionally as doc).
void TRANSPARENT;
