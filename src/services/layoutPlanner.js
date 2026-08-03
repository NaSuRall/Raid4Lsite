import path from 'node:path';
import sharp from 'sharp';
import db from '../db.js';
import { UPLOADS_DIR } from '../paths.js';

// Page geometry in points (A4). Must stay in sync with src/services/pdfGenerator.js.
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 36;
export const GAP = 16;

function photoPath(photo) {
  return path.join(UPLOADS_DIR, photo.participant_id, photo.filename);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Runs the same smart-crop sharp will use at render time, and reads back
// *where* it centered the crop (sharp exposes this via attentionX/Y on the
// scaled, pre-crop image). Converting that to a 0..1 fraction of the
// original photo gives the exact focal point the automatic crop picked.
async function getAttentionFocalPoint(filePath, boxW, boxH) {
  try {
    const meta = await sharp(filePath).metadata();
    let { width, height, orientation } = meta;
    if (orientation && orientation >= 5) [width, height] = [height, width];
    if (!width || !height) return { x: 0.5, y: 0.5 };

    const { info } = await sharp(filePath)
      .rotate()
      .resize(Math.max(1, Math.round(boxW)), Math.max(1, Math.round(boxH)), {
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      .toBuffer({ resolveWithObject: true });

    const scale = Math.max(boxW / width, boxH / height);
    const scaledW = width * scale;
    const scaledH = height * scale;
    const x = scaledW > 0 ? (info.attentionX ?? scaledW / 2) / scaledW : 0.5;
    const y = scaledH > 0 ? (info.attentionY ?? scaledH / 2) / scaledH : 0.5;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  } catch {
    return { x: 0.5, y: 0.5 };
  }
}

// Persists the smart-crop's focal point for a photo so the on-screen preview
// shows exactly what the automatic crop will produce. Never overwrites a
// focal point that's already set (manual choices, or a previous seed, win).
export async function seedAutoCrop(photo, boxW, boxH) {
  const row = db.prepare('SELECT crop_x FROM photos WHERE id = ?').get(photo.id);
  if (!row || row.crop_x != null) return;
  const { x, y } = await getAttentionFocalPoint(photoPath(photo), boxW, boxH);
  db.prepare('UPDATE photos SET crop_x = ?, crop_y = ? WHERE id = ?').run(x, y, photo.id);
}

// Decides, once, which photo goes on which page and in which of the three
// layouts (feature / quad / six) it lands, and seeds each photo's default
// crop focal point for its assigned box. The result is meant to be frozen
// (stored as JSON) so the on-screen crop preview and the final PDF always
// agree on exactly the same arrangement.
export async function buildLayout(photos) {
  const shuffled = shuffle(photos);
  const pages = [];
  let idx = 0;

  const contentW = PAGE_WIDTH - MARGIN * 2;
  const contentH = PAGE_HEIGHT - MARGIN * 2;
  const featureBox = { w: contentW, h: contentH };
  const quadBox = { w: (contentW - GAP) / 2, h: (contentH - GAP) / 2 };
  const sixBox = { w: (contentW - GAP) / 2, h: (contentH - GAP * 2) / 3 };
  const pageSizes = planPageSizes(shuffled.length);

  for (const count of pageSizes) {
    const batch = shuffled.slice(idx, idx + count);

    if (count === 1) {
      await seedAutoCrop(batch[0], featureBox.w, featureBox.h);
      pages.push({ type: 'feature', photoIds: batch.map((p) => p.id) });
    } else if (count === 4) {
      await Promise.all(batch.map((p) => seedAutoCrop(p, quadBox.w, quadBox.h)));
      pages.push({ type: 'quad', photoIds: batch.map((p) => p.id) });
    } else {
      await Promise.all(batch.map((p) => seedAutoCrop(p, sixBox.w, sixBox.h)));
      pages.push({ type: 'six', photoIds: batch.map((p) => p.id) });
    }

    idx += batch.length;
  }

  return pages;
}

// Splits a photo count into complete pages containing exactly 1, 4 or 6
// photos. The dynamic program first minimizes the page count, then avoids
// single-photo pages when a full mosaic is possible.
export function planPageSizes(total) {
  const best = Array(total + 1).fill(null);
  best[0] = { sizes: [], singles: 0 };

  for (let count = 1; count <= total; count++) {
    for (const size of [6, 4, 1]) {
      if (count < size || !best[count - size]) continue;
      const candidate = {
        sizes: [...best[count - size].sizes, size],
        singles: best[count - size].singles + (size === 1 ? 1 : 0),
      };
      const current = best[count];
      if (
        !current ||
        candidate.sizes.length < current.sizes.length ||
        (candidate.sizes.length === current.sizes.length && candidate.singles < current.singles)
      ) {
        best[count] = candidate;
      }
    }
  }

  return best[total]?.sizes || [];
}
