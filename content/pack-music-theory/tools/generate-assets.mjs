#!/usr/bin/env node
/**
 * Deterministic SVG asset generator for the music-theory pack.
 *
 * Every image the pack's questions reference is rendered here from a
 * declarative spec (pitch names, key-signature counts, keyboard
 * highlights, …), so the picture can never drift from the answer key.
 * Zero dependencies — run `node tools/generate-assets.mjs` from the
 * pack directory to (re)build `assets/`.
 *
 * Style: warm "paper card" background baked into each SVG so the
 * images stay legible on both the light and dark app themes, with
 * line-art notation in near-black ink and the pack's violet accent
 * for highlights.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const INK = '#26221b';
const PAPER = '#fffdf6';
const EDGE = '#eadfc8';
const MUTED = '#a89f8c';
const ACCENT = '#7c3aed';
const ACCENT_SOFT = '#ede9fe';

const S = 12; // staff line spacing
const FONT = `Georgia, 'Times New Roman', serif`;

// ---------------------------------------------------------------- helpers

function card(w, h, inner, { pad = 0 } = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="14" fill="${PAPER}" stroke="${EDGE}" stroke-width="2"/>` +
    inner +
    `</svg>`
  );
}

function line(x1, y1, x2, y2, w = 1.6, color = INK, cap = 'round') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}"/>`;
}

function staffLines(x0, x1, y0) {
  let s = '';
  for (let i = 0; i < 5; i++) s += line(x0, y0 + i * S, x1, y0 + i * S, 1.4, INK, 'butt');
  return s;
}

// Diatonic step of a pitch above a clef's bottom staff line.
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const CLEF_REF = { treble: 30 /* E4 */, bass: 18 /* G2 */, alto: 24 /* F3 */ };
function stepOf(pitch, clef) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(pitch);
  if (!m) throw new Error(`bad pitch ${pitch}`);
  const abs = Number(m[3]) * 7 + LETTERS.indexOf(m[1]);
  return { step: abs - CLEF_REF[clef], acc: m[2] };
}
const stepY = (y0, step) => y0 + 4 * S - step * (S / 2);

function ledgerLines(x, y0, step) {
  let s = '';
  if (step <= -2) for (let st = -2; st >= step; st -= 2) s += line(x - 14, stepY(y0, st), x + 14, stepY(y0, st), 1.4, INK, 'butt');
  if (step >= 10) for (let st = 10; st <= step; st += 2) s += line(x - 14, stepY(y0, st), x + 14, stepY(y0, st), 1.4, INK, 'butt');
  return s;
}

// ------------------------------------------------------------- note glyphs

function wholeHead(x, y, color = INK) {
  return (
    `<g transform="translate(${x},${y})">` +
    `<ellipse rx="9.4" ry="6.1" fill="${color}"/>` +
    `<ellipse rx="4.6" ry="3.3" fill="${PAPER}" transform="rotate(-32)"/>` +
    `</g>`
  );
}

function head(x, y, filled, color = INK) {
  const fill = filled ? color : 'none';
  return `<ellipse cx="${x}" cy="${y}" rx="7.4" ry="5.4" transform="rotate(-20 ${x} ${y})" fill="${fill}" stroke="${color}" stroke-width="1.9"/>`;
}

function flagPath(sx, sy, up) {
  // A single pennant flag off the stem tip.
  if (up) {
    return `<path d="M ${sx},${sy} C ${sx + 9},${sy + 7} ${sx + 12},${sy + 13} ${sx + 7.5},${sy + 24} C ${sx + 9.5},${sy + 14} ${sx + 6},${sy + 10} ${sx},${sy + 8} Z" fill="${INK}"/>`;
  }
  return `<path d="M ${sx},${sy} C ${sx + 9},${sy - 7} ${sx + 12},${sy - 13} ${sx + 7.5},${sy - 24} C ${sx + 9.5},${sy - 14} ${sx + 6},${sy - 10} ${sx},${sy - 8} Z" fill="${INK}"/>`;
}

/**
 * A note glyph at (x,y). dur: whole|half|quarter|eighth|sixteenth.
 * `up` — stem direction. `dots` — augmentation dots.
 */
function note(x, y, dur, { up = true, dots = 0, color = INK } = {}) {
  let s = '';
  if (dur === 'whole') {
    s += wholeHead(x, y, color);
  } else {
    s += head(x, y, dur !== 'half', color);
    const sx = up ? x + 6.6 : x - 6.6;
    const sy1 = up ? y - 2.5 : y + 2.5;
    const sy2 = up ? y - 36 : y + 36;
    s += line(sx, sy1, sx, sy2, 1.9, color);
    if (dur === 'eighth' || dur === 'sixteenth') s += flagPath(sx, sy2, up);
    if (dur === 'sixteenth') s += flagPath(sx, up ? sy2 + 8 : sy2 - 8, up);
  }
  for (let i = 0; i < dots; i++) {
    s += `<circle cx="${x + 14 + i * 7}" cy="${y}" r="2.5" fill="${color}"/>`;
  }
  return s;
}

// ------------------------------------------------------------- accidentals

function sharpGlyph(x, y, scale = 1, color = INK) {
  const bar = (cy) =>
    `<path d="M -6.5,${cy + 3.4} L 6.5,${cy - 0.2} L 6.5,${cy - 3.4} L -6.5,${cy + 0.2} Z" fill="${color}"/>`;
  return (
    `<g transform="translate(${x},${y}) scale(${scale})">` +
    line(-3, -9.5, -3, 11.5, 1.5, color) +
    line(3, -11.5, 3, 9.5, 1.5, color) +
    bar(-4) +
    bar(4) +
    `</g>`
  );
}

function flatGlyph(x, y, scale = 1, color = INK) {
  return (
    `<g transform="translate(${x},${y}) scale(${scale})">` +
    line(-3, -15, -3, 7.5, 1.5, color) +
    `<path d="M -3,7.5 C 4,3 7,-0.5 4.5,-3.5 C 2.5,-5.5 -1.5,-3.5 -3,-0.5 Z" fill="${color}"/>` +
    `</g>`
  );
}

function naturalGlyph(x, y, scale = 1, color = INK) {
  const bar = (cy) =>
    `<path d="M -3.6,${cy + 3} L 3.6,${cy + 0.4} L 3.6,${cy - 3} L -3.6,${cy - 0.4} Z" fill="${color}"/>`;
  return (
    `<g transform="translate(${x},${y}) scale(${scale})">` +
    line(-3.6, -12, -3.6, 5, 1.5, color) +
    line(3.6, -5, 3.6, 12, 1.5, color) +
    bar(-3.8) +
    bar(3.8) +
    `</g>`
  );
}

function doubleSharpGlyph(x, y, scale = 1, color = INK) {
  const arm = (a) =>
    `<g transform="rotate(${a})">` +
    `<rect x="-8" y="-2.1" width="16" height="4.2" fill="${color}"/>` +
    `</g>`;
  const dot = (dx, dy) => `<rect x="${dx - 3}" y="${dy - 3}" width="6" height="6" fill="${color}"/>`;
  return (
    `<g transform="translate(${x},${y}) scale(${scale})">` +
    arm(45) +
    arm(-45) +
    dot(-6.4, -6.4) +
    dot(6.4, -6.4) +
    dot(-6.4, 6.4) +
    dot(6.4, 6.4) +
    `</g>`
  );
}

function accidental(kind, x, y, scale = 1, color = INK) {
  if (kind === '#') return sharpGlyph(x, y, scale, color);
  if (kind === 'b') return flatGlyph(x, y, scale, color);
  if (kind === 'n') return naturalGlyph(x, y, scale, color);
  if (kind === 'x') return doubleSharpGlyph(x, y, scale, color);
  return '';
}

// ------------------------------------------------------------------ clefs

function trebleClef(x, y0) {
  // Line-art G clef: body stroke + stem stroke + tail blob. The big
  // lower loop is centred on the G line (y0 + 3S).
  const g = (d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  const body =
    `M ${x + 2},${y0 - 12} ` +
    `C ${x + 8},${y0 - 7} ${x + 9},${y0 + 1} ${x + 5},${y0 + 7} ` +
    `C ${x - 2},${y0 + 16} ${x - 8},${y0 + 20} ${x - 8},${y0 + 28} ` +
    `C ${x - 8},${y0 + 37} ${x - 1.5},${y0 + 43} ${x + 3.5},${y0 + 43} ` +
    `C ${x + 9.5},${y0 + 43} ${x + 11.5},${y0 + 36} ${x + 9},${y0 + 31.5} ` +
    `C ${x + 7},${y0 + 27.5} ${x + 1},${y0 + 27} ${x - 1.5},${y0 + 30.5}`;
  const stem = `M ${x + 2},${y0 - 12} L ${x + 2},${y0 + 53} C ${x + 2},${y0 + 59} ${x - 6},${y0 + 59} ${x - 6},${y0 + 54}`;
  return g(body) + g(stem) + `<circle cx="${x - 3.6}" cy="${y0 + 54.5}" r="2.6" fill="${INK}"/>`;
}

function bassClef(x, y0) {
  const body =
    `M ${x - 7},${y0 + 17} ` +
    `C ${x - 10},${y0 + 7} ${x - 3},${y0 + 1} ${x + 2},${y0 + 1.5} ` +
    `C ${x + 9},${y0 + 2.5} ${x + 11.5},${y0 + 9} ${x + 9.5},${y0 + 16} ` +
    `C ${x + 7},${y0 + 26} ${x - 1},${y0 + 33} ${x - 8},${y0 + 37}`;
  return (
    `<path d="${body}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>` +
    `<circle cx="${x - 6.2}" cy="${y0 + 14}" r="3.6" fill="${INK}"/>` +
    `<circle cx="${x + 16}" cy="${y0 + 6}" r="2.1" fill="${INK}"/>` +
    `<circle cx="${x + 16}" cy="${y0 + 18}" r="2.1" fill="${INK}"/>`
  );
}

function altoClef(x, y0) {
  const curl = (sy, flip) => {
    const f = flip ? -1 : 1;
    return (
      `<path d="M ${x - 1},${sy + f * 2} C ${x + 8},${sy - f * 3} ${x + 11},${sy + f * 9} ${x + 6.5},${sy + f * 15} ` +
      `C ${x + 4},${sy + f * 18.5} ${x + 0.5},${sy + f * 19.5} ${x - 1},${sy + f * 17.5}" ` +
      `fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`
    );
  };
  return (
    line(x - 11, y0, x - 11, y0 + 48, 4.6, INK, 'butt') +
    line(x - 4.5, y0, x - 4.5, y0 + 48, 1.8, INK, 'butt') +
    curl(y0 + 3, false) +
    curl(y0 + 45, true)
  );
}

function clef(kind, x, y0) {
  if (kind === 'treble') return trebleClef(x, y0);
  if (kind === 'bass') return bassClef(x, y0);
  return altoClef(x, y0);
}

// ------------------------------------------------------------------ rests

function restGlyph(kind, x, y0) {
  const mid = y0 + 2 * S;
  if (kind === 'whole') return `<rect x="${x - 8}" y="${y0 + S}" width="16" height="5.5" fill="${INK}"/>`;
  if (kind === 'half') return `<rect x="${x - 8}" y="${mid - 5.5}" width="16" height="5.5" fill="${INK}"/>`;
  if (kind === 'quarter') {
    return (
      `<path d="M ${x - 1},${y0 + 7} L ${x + 7},${y0 + 17} Q ${x + 1},${y0 + 23} ${x + 7},${y0 + 30} ` +
      `Q ${x - 2.5},${y0 + 27} ${x + 0.5},${y0 + 38}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`
    );
  }
  // eighth rest: dot + curve + slash, roughly a "7".
  return (
    `<circle cx="${x - 4}" cy="${mid - 5}" r="3" fill="${INK}"/>` +
    `<path d="M ${x - 2.5},${mid - 3} Q ${x + 2},${mid} ${x + 6},${mid - 6}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    line(x + 6, mid - 6, x, mid + 14, 2.2)
  );
}

// ----------------------------------------------------------- staff assets

/** Staff card with a clef and zero or more whole notes (with accidentals). */
function staffCard({ clef: clefKind = 'treble', pitches = [], w = 300, noteXs, label }) {
  const h = 168;
  const y0 = 60;
  let inner = staffLines(24, w - 24, y0) + clef(clefKind, 52, y0);
  const xs = noteXs ?? pitches.map((_, i) => (pitches.length === 1 ? w / 2 + 24 : 118 + i * ((w - 172) / Math.max(1, pitches.length - 1))));
  pitches.forEach((p, i) => {
    const { step, acc } = stepOf(p, clefKind);
    const y = stepY(y0, step);
    inner += ledgerLines(xs[i], y0, step);
    if (acc) inner += accidental(acc, xs[i] - 21, y, 1);
    inner += wholeHead(xs[i], y);
  });
  if (label) {
    inner += `<text x="${w / 2}" y="${h - 16}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${MUTED}">${label}</text>`;
  }
  return card(w, h, inner);
}

/** Chord card — whole notes stacked at one x. */
function chordCard({ pitches, clef: clefKind = 'treble', w = 260 }) {
  const h = 176;
  const y0 = 64;
  let inner = staffLines(24, w - 24, y0) + clef(clefKind, 52, y0);
  const x = w / 2 + 30;
  let accCount = 0;
  for (const p of pitches) {
    const { step, acc } = stepOf(p, clefKind);
    const y = stepY(y0, step);
    inner += ledgerLines(x, y0, step);
    if (acc) {
      inner += accidental(acc, x - 22 - accCount * 14, y, 1);
      accCount++;
    }
    inner += wholeHead(x, y);
  }
  return card(w, h, inner);
}

/** Key signature card. */
function keysigCard({ kind, count }) {
  const w = 280;
  const h = 168;
  const y0 = 60;
  const SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4]; // F5 C5 G5 D5 A4 E5 B4
  const FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1]; // B4 E5 A4 D5 G4 C5 F4
  const steps = (kind === 'sharp' ? SHARP_STEPS : FLAT_STEPS).slice(0, count);
  let inner = staffLines(24, w - 24, y0) + trebleClef(52, y0);
  steps.forEach((st, i) => {
    inner += accidental(kind === 'sharp' ? '#' : 'b', 92 + i * 20, stepY(y0, st), 1);
  });
  return card(w, h, inner);
}

/** Symbol card — one large accidental glyph. */
function symbolCard(kind) {
  const w = 160;
  const h = 160;
  return card(w, h, accidental(kind, w / 2, h / 2 + (kind === 'b' ? 6 : 0), 3.2));
}

/** Note-value card — one large note glyph, no staff. */
function valueCard(dur, dots = 0) {
  const w = 170;
  const h = 170;
  const cx = dur === 'whole' ? w / 2 : w / 2 - 8;
  const cy = dur === 'whole' ? h / 2 : h / 2 + 26;
  return card(
    w,
    h,
    `<g transform="translate(${cx},${cy}) scale(1.6) translate(${-cx},${-cy})">` +
      note(cx, cy, dur, { up: true, dots }) +
      `</g>`,
  );
}

/** Rest card — glyph on a five-line staff fragment. */
function restCard(kind) {
  const w = 190;
  const h = 150;
  const y0 = 50;
  return card(w, h, staffLines(28, w - 28, y0) + restGlyph(kind, w / 2, y0));
}

/** Time-signature card: staff + treble clef + stacked numbers (or cut-C). */
function timesigCard({ top, bottom, cut = false }) {
  const w = 250;
  const h = 160;
  const y0 = 56;
  let inner = staffLines(24, w - 24, y0) + trebleClef(52, y0);
  const x = 122;
  if (cut) {
    inner +=
      `<path d="M ${x + 12},${y0 + 12} A 14 15 0 1 0 ${x + 12},${y0 + 36}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>` +
      line(x + 2, y0 - 2, x + 2, y0 + 50, 2.6);
  } else {
    const num = (t, y) =>
      `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="bold" fill="${INK}">${t}</text>`;
    inner += num(top, y0 + 20) + num(bottom, y0 + 45);
  }
  return card(w, h, inner);
}

/** A single measure with time signature, notes and a barline. */
function measureCard({ top, bottom, events, missing = false }) {
  const w = 320;
  const h = 168;
  const y0 = 60;
  let inner = staffLines(24, w - 24, y0) + trebleClef(50, y0);
  const num = (t, y) =>
    `<text x="104" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="bold" fill="${INK}">${t}</text>`;
  inner += num(top, y0 + 20) + num(bottom, y0 + 45);
  const startX = 148;
  const slot = (w - 60 - startX) / events.length;
  events.forEach((ev, i) => {
    const x = startX + slot * i + slot / 2;
    if (ev === '?') {
      inner +=
        `<rect x="${x - 16}" y="${y0 + 6}" width="32" height="36" rx="6" fill="${ACCENT_SOFT}" stroke="${ACCENT}" stroke-width="1.8" stroke-dasharray="4 3"/>` +
        `<text x="${x}" y="${y0 + 31}" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="bold" fill="${ACCENT}">?</text>`;
      return;
    }
    const { step } = stepOf(ev.pitch, 'treble');
    const y = stepY(y0, step);
    inner += note(x, y, ev.dur, { up: step < 4, dots: ev.dots ?? 0 });
  });
  inner += line(w - 40, y0, w - 40, y0 + 48, 1.6, INK, 'butt');
  inner += line(w - 34, y0, w - 34, y0 + 48, 4.4, INK, 'butt');
  void missing;
  return card(w, h, inner);
}

/** Two tied quarter notes on G4. */
function tieCard() {
  const w = 280;
  const h = 168;
  const y0 = 60;
  const { step } = stepOf('G4', 'treble');
  const y = stepY(y0, step);
  let inner = staffLines(24, w - 24, y0) + trebleClef(52, y0);
  inner += note(150, y, 'quarter', { up: true });
  inner += note(210, y, 'quarter', { up: true });
  inner += `<path d="M 152,${y + 11} C 168,${y + 22} 192,${y + 22} 208,${y + 11}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  return card(w, h, inner);
}

/** Three beamed eighth notes with a triplet 3. */
function tripletCard() {
  const w = 260;
  const h = 168;
  const y0 = 62;
  const { step } = stepOf('B4', 'treble');
  const y = stepY(y0, step);
  let inner = staffLines(24, w - 24, y0) + trebleClef(50, y0);
  const xs = [140, 178, 216];
  const beamY = y - 34;
  for (const x of xs) {
    inner += head(x, y, true);
    inner += line(x + 6.6, y - 2.5, x + 6.6, beamY, 1.9);
  }
  inner += `<rect x="${xs[0] + 5.6}" y="${beamY}" width="${xs[2] - xs[0] + 2}" height="5" fill="${INK}"/>`;
  inner += `<text x="${xs[1] + 6}" y="${beamY - 8}" text-anchor="middle" font-family="${FONT}" font-size="17" font-style="italic" font-weight="bold" fill="${INK}">3</text>`;
  return card(w, h, inner);
}

// --------------------------------------------------------------- keyboard

const WHITE_SEQ = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_AFTER = new Set(['C', 'D', 'F', 'G', 'A']);

/**
 * Piano keyboard card. octaves: 1 → keys C..C (8 white); 2 → C..C (15).
 * highlights: array of key ids like "C", "F#", "C+1" (next octave),
 * "F#+1". Whole keys get the accent fill.
 */
function keyboardCard({ octaves = 1, highlights = [] }) {
  const hl = new Set(highlights);
  const WW = octaves === 1 ? 34 : 24;
  const WH = octaves === 1 ? 124 : 108;
  const BW = WW * 0.62;
  const BH = WH * 0.62;
  const nWhite = octaves * 7 + 1;
  const pad = 20;
  const w = nWhite * WW + pad * 2;
  const h = WH + pad * 2 + 10;
  const whiteId = (i) => {
    const name = WHITE_SEQ[i % 7];
    const oct = Math.floor(i / 7);
    return oct === 0 ? name : `${name}+${oct}`;
  };
  let whites = '';
  let blacks = '';
  for (let i = 0; i < nWhite; i++) {
    const x = pad + i * WW;
    const id = whiteId(i);
    const on = hl.has(id);
    whites += `<rect x="${x}" y="${pad}" width="${WW}" height="${WH}" fill="${on ? ACCENT_SOFT : '#ffffff'}" stroke="${INK}" stroke-width="1.4"/>`;
    if (on) whites += `<circle cx="${x + WW / 2}" cy="${pad + WH - 16}" r="${WW * 0.19}" fill="${ACCENT}"/>`;
  }
  for (let i = 0; i < nWhite - 1; i++) {
    const name = WHITE_SEQ[i % 7];
    if (!BLACK_AFTER.has(name)) continue;
    const oct = Math.floor(i / 7);
    const sharpId = oct === 0 ? `${name}#` : `${name}#+${oct}`;
    const on = hl.has(sharpId);
    const x = pad + (i + 1) * WW - BW / 2;
    blacks += `<rect x="${x}" y="${pad}" width="${BW}" height="${BH}" rx="2" fill="${on ? ACCENT : INK}" stroke="${INK}" stroke-width="1"/>`;
    if (on) blacks += `<circle cx="${x + BW / 2}" cy="${pad + BH - 10}" r="${BW * 0.2}" fill="#ffffff"/>`;
  }
  return card(w, h, whites + blacks);
}

// -------------------------------------------------------- circle of fifths

function circleCard({ mystery } = {}) {
  const w = 320;
  const h = 320;
  const cx = w / 2;
  const cy = h / 2;
  const R = 118;
  const names = ['C', 'G', 'D', 'A', 'E', 'B', 'F#/G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
  let inner = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${MUTED}" stroke-width="1.8"/>`;
  inner += `<circle cx="${cx}" cy="${cy}" r="${R - 38}" fill="none" stroke="${EDGE}" stroke-width="1.4"/>`;
  names.forEach((n, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * (R - 19);
    const y = cy + Math.sin(a) * (R - 19);
    const isMystery = mystery === n || (mystery && n.startsWith(mystery + '/'));
    if (isMystery || mystery === i) {
      inner += `<circle cx="${x}" cy="${y}" r="16" fill="${ACCENT_SOFT}" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="4 3"/>`;
      inner += `<text x="${x}" y="${y + 6}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="bold" fill="${ACCENT}">?</text>`;
    } else {
      inner += `<text x="${x}" y="${y + 5.5}" text-anchor="middle" font-family="${FONT}" font-size="${n.length > 2 ? 12 : 16}" font-weight="bold" fill="${INK}">${n}</text>`;
    }
  });
  inner += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${MUTED}">5ths →</text>`;
  return card(w, h, inner);
}

// ------------------------------------------------------------ asset table

const ASSETS = {
  // clefs
  'clef-treble.svg': staffCard({ clef: 'treble' }),
  'clef-bass.svg': staffCard({ clef: 'bass' }),
  'clef-alto.svg': staffCard({ clef: 'alto' }),
  // single notes — treble
  'note-treble-g4.svg': staffCard({ pitches: ['G4'] }),
  'note-treble-f4.svg': staffCard({ pitches: ['F4'] }),
  'note-treble-b4.svg': staffCard({ pitches: ['B4'] }),
  'note-treble-c5.svg': staffCard({ pitches: ['C5'] }),
  'note-treble-c4.svg': staffCard({ pitches: ['C4'] }),
  'note-treble-a5.svg': staffCard({ pitches: ['A5'] }),
  'note-treble-f5-sharp.svg': staffCard({ pitches: ['F#5'] }),
  'note-treble-spaces.svg': staffCard({ pitches: ['F4', 'A4', 'C5', 'E5'], w: 340 }),
  // single notes — bass / alto
  'note-bass-f3.svg': staffCard({ clef: 'bass', pitches: ['F3'] }),
  'note-bass-d3.svg': staffCard({ clef: 'bass', pitches: ['D3'] }),
  'note-bass-a2.svg': staffCard({ clef: 'bass', pitches: ['A2'] }),
  'note-bass-c4.svg': staffCard({ clef: 'bass', pitches: ['C4'] }),
  'note-alto-c4.svg': staffCard({ clef: 'alto', pitches: ['C4'] }),
  // accidental symbol cards
  'sym-sharp.svg': symbolCard('#'),
  'sym-flat.svg': symbolCard('b'),
  'sym-natural.svg': symbolCard('n'),
  'sym-doublesharp.svg': symbolCard('x'),
  // note values
  'value-whole.svg': valueCard('whole'),
  'value-half.svg': valueCard('half'),
  'value-quarter.svg': valueCard('quarter'),
  'value-eighth.svg': valueCard('eighth'),
  'value-sixteenth.svg': valueCard('sixteenth'),
  'value-dotted-half.svg': valueCard('half', 1),
  'value-dotted-quarter.svg': valueCard('quarter', 1),
  'value-dotted-eighth.svg': valueCard('eighth', 1),
  // rests
  'rest-whole.svg': restCard('whole'),
  'rest-half.svg': restCard('half'),
  'rest-quarter.svg': restCard('quarter'),
  'rest-eighth.svg': restCard('eighth'),
  // time signatures
  'timesig-4-4.svg': timesigCard({ top: 4, bottom: 4 }),
  'timesig-3-4.svg': timesigCard({ top: 3, bottom: 4 }),
  'timesig-6-8.svg': timesigCard({ top: 6, bottom: 8 }),
  'timesig-cut.svg': timesigCard({ cut: true }),
  // measures
  'measure-3-4-missing.svg': measureCard({
    top: 3,
    bottom: 4,
    events: [{ pitch: 'G4', dur: 'quarter' }, { pitch: 'A4', dur: 'quarter' }, '?'],
  }),
  'measure-2-4-complete.svg': measureCard({
    top: 2,
    bottom: 4,
    events: [
      { pitch: 'G4', dur: 'eighth' },
      { pitch: 'A4', dur: 'eighth' },
      { pitch: 'B4', dur: 'quarter' },
    ],
  }),
  'tie.svg': tieCard(),
  'triplet.svg': tripletCard(),
  // key signatures
  'keysig-1-sharp.svg': keysigCard({ kind: 'sharp', count: 1 }),
  'keysig-2-sharps.svg': keysigCard({ kind: 'sharp', count: 2 }),
  'keysig-4-sharps.svg': keysigCard({ kind: 'sharp', count: 4 }),
  'keysig-5-sharps.svg': keysigCard({ kind: 'sharp', count: 5 }),
  'keysig-7-sharps.svg': keysigCard({ kind: 'sharp', count: 7 }),
  'keysig-1-flat.svg': keysigCard({ kind: 'flat', count: 1 }),
  'keysig-3-flats.svg': keysigCard({ kind: 'flat', count: 3 }),
  'keysig-6-flats.svg': keysigCard({ kind: 'flat', count: 6 }),
  // keyboards
  'kb-c.svg': keyboardCard({ highlights: ['C'] }),
  'kb-fsharp.svg': keyboardCard({ highlights: ['F#'] }),
  'kb-e-f.svg': keyboardCard({ highlights: ['E', 'F'] }),
  'kb-c-d.svg': keyboardCard({ highlights: ['C', 'D'] }),
  'kb-c-g.svg': keyboardCard({ highlights: ['C', 'G'] }),
  'kb-c-major.svg': keyboardCard({ highlights: ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C+1'] }),
  'kb-c-major-triad.svg': keyboardCard({ highlights: ['C', 'E', 'G'] }),
  'kb-f-major-triad.svg': keyboardCard({ highlights: ['F', 'A', 'C+1'] }),
  'kb-d-dorian.svg': keyboardCard({ octaves: 2, highlights: ['D', 'E', 'F', 'G', 'A', 'B', 'C+1', 'D+1'] }),
  'kb-g-mixolydian.svg': keyboardCard({ octaves: 2, highlights: ['G', 'A', 'B', 'C+1', 'D+1', 'E+1', 'F+1', 'G+1'] }),
  // scale on a staff
  'scale-a-harmonic-minor.svg': staffCard({
    pitches: ['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G#5', 'A5'],
    w: 420,
  }),
  // intervals (melodic, two whole notes)
  'interval-c4-c5.svg': staffCard({ pitches: ['C4', 'C5'], noteXs: [150, 205] }),
  'interval-c4-g4.svg': staffCard({ pitches: ['C4', 'G4'], noteXs: [150, 205] }),
  'interval-c4-e4.svg': staffCard({ pitches: ['C4', 'E4'], noteXs: [150, 205] }),
  'interval-f4-g4.svg': staffCard({ pitches: ['F4', 'G4'], noteXs: [150, 205] }),
  'interval-e4-g4.svg': staffCard({ pitches: ['E4', 'G4'], noteXs: [150, 205] }),
  'interval-c4-f4.svg': staffCard({ pitches: ['C4', 'F4'], noteXs: [150, 205] }),
  'interval-d4-a4.svg': staffCard({ pitches: ['D4', 'A4'], noteXs: [150, 205] }),
  'interval-c4-a4.svg': staffCard({ pitches: ['C4', 'A4'], noteXs: [150, 205] }),
  'interval-e4-f4.svg': staffCard({ pitches: ['E4', 'F4'], noteXs: [150, 205] }),
  'interval-f4-b4.svg': staffCard({ pitches: ['F4', 'B4'], noteXs: [150, 205] }),
  'interval-c4-b4.svg': staffCard({ pitches: ['C4', 'B4'], noteXs: [150, 205] }),
  'interval-c4-d5.svg': staffCard({ pitches: ['C4', 'D5'], noteXs: [150, 205] }),
  // chords (stacked whole notes)
  'chord-c-major.svg': chordCard({ pitches: ['C4', 'E4', 'G4'] }),
  'chord-a-minor.svg': chordCard({ pitches: ['A4', 'C5', 'E5'] }),
  'chord-g-major.svg': chordCard({ pitches: ['G4', 'B4', 'D5'] }),
  'chord-b-dim.svg': chordCard({ pitches: ['B4', 'D5', 'F5'] }),
  'chord-c-aug.svg': chordCard({ pitches: ['C5', 'E5', 'G#5'] }),
  'chord-g7.svg': chordCard({ pitches: ['G4', 'B4', 'D5', 'F5'] }),
  'chord-c-first-inversion.svg': chordCard({ pitches: ['E4', 'G4', 'C5'] }),
  'chord-d-minor7.svg': chordCard({ pitches: ['D4', 'F4', 'A4', 'C5'] }),
  // circle of fifths
  'circle-fifths.svg': circleCard(),
  'circle-fifths-mystery.svg': circleCard({ mystery: 'A' }),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(ASSETS)) {
  fs.writeFileSync(path.join(OUT, name), svg + '\n');
}
console.log(`wrote ${Object.keys(ASSETS).length} assets to ${OUT}`);
