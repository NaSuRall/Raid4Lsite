import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDF_PATH, UPLOADS_DIR } from '../paths.js';

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const GAP = 16;

function photoPath(photo) {
  return path.join(UPLOADS_DIR, photo.participant_id, photo.filename);
}

// Smart-crop fallback: resizes+crops to exactly fill a box, cropping toward
// the most visually interesting region (used when nobody has manually
// picked a focal point for this photo yet).
async function loadAutoCropBuffer(filePath, boxW, boxH, scale = 2.5) {
  return sharp(filePath)
    .rotate()
    .resize(Math.max(1, Math.round(boxW * scale)), Math.max(1, Math.round(boxH * scale)), {
      fit: 'cover',
      position: sharp.strategy.attention,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// Manual crop: extracts the largest box-shaped region centered on the
// admin-chosen focal point (normalized 0..1), clamped to the image bounds.
async function loadManualCropBuffer(filePath, boxW, boxH, focalX, focalY, zoom = 1, scale = 2.5) {
  const { data, info } = await sharp(filePath).rotate().toBuffer({ resolveWithObject: true });
  const iw = info.width;
  const ih = info.height;
  const targetRatio = boxW / boxH;

  let cw;
  let ch;
  if (iw / ih > targetRatio) {
    ch = ih;
    cw = Math.round(ih * targetRatio);
  } else {
    cw = iw;
    ch = Math.round(iw / targetRatio);
  }
  cw = Math.max(1, Math.min(Math.round(cw / zoom), iw));
  ch = Math.max(1, Math.min(Math.round(ch / zoom), ih));

  let left = Math.round(focalX * iw - cw / 2);
  let top = Math.round(focalY * ih - ch / 2);
  left = Math.max(0, Math.min(left, iw - cw));
  top = Math.max(0, Math.min(top, ih - ch));

  return sharp(data)
    .extract({ left, top, width: cw, height: ch })
    .resize(Math.max(1, Math.round(boxW * scale)), Math.max(1, Math.round(boxH * scale)))
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function loadBoxBuffer(photo, boxW, boxH) {
  const filePath = photoPath(photo);
  if (photo.crop_mode === 'contain') {
    const scale = 2.5;
    return sharp(filePath)
      .rotate()
      .resize(Math.max(1, Math.round(boxW * scale)), Math.max(1, Math.round(boxH * scale)), {
        fit: 'contain',
        background: '#ffffff',
      })
      .jpeg({ quality: 90 })
      .toBuffer();
  }
  if (photo.crop_x != null && photo.crop_y != null) {
    return loadManualCropBuffer(
      filePath,
      boxW,
      boxH,
      photo.crop_x,
      photo.crop_y,
      Math.min(3, Math.max(1, photo.crop_zoom || 1))
    );
  }
  return loadAutoCropBuffer(filePath, boxW, boxH);
}

function drawPlaceholder(doc, x, y, w, h) {
  doc.rect(x, y, w, h).fill('#eeeeee');
}

async function drawInBox(doc, photo, box) {
  try {
    const buffer = await loadBoxBuffer(photo, box.w, box.h);
    doc.image(buffer, box.x, box.y, { width: box.w, height: box.h });
  } catch (err) {
    console.warn(`[pdf] photo ignoree (${photoPath(photo)}):`, err.message);
    drawPlaceholder(doc, box.x, box.y, box.w, box.h);
  }
}

async function drawFeaturePage(doc, photo) {
  if (!photo) return;
  await drawInBox(doc, photo, {
    x: MARGIN,
    y: MARGIN,
    w: PAGE_WIDTH - MARGIN * 2,
    h: PAGE_HEIGHT - MARGIN * 2,
  });
}

async function drawQuadPage(doc, photos) {
  const cols = 2;
  const rows = 2;
  const cellW = (PAGE_WIDTH - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cellH = (PAGE_HEIGHT - MARGIN * 2 - GAP * (rows - 1)) / rows;

  for (let i = 0; i < photos.length; i++) {
    if (!photos[i]) continue;
    const col = i % cols;
    const row = Math.floor(i / cols);
    await drawInBox(doc, photos[i], {
      x: MARGIN + col * (cellW + GAP),
      y: MARGIN + row * (cellH + GAP),
      w: cellW,
      h: cellH,
    });
  }
}

async function drawSixPage(doc, photos) {
  const cols = 2;
  const rows = 3;
  const cellW = (PAGE_WIDTH - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cellH = (PAGE_HEIGHT - MARGIN * 2 - GAP * (rows - 1)) / rows;

  for (let i = 0; i < photos.length; i++) {
    if (!photos[i]) continue;
    const col = i % cols;
    const row = Math.floor(i / cols);
    await drawInBox(doc, photos[i], {
      x: MARGIN + col * (cellW + GAP),
      y: MARGIN + row * (cellH + GAP),
      w: cellW,
      h: cellH,
    });
  }
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[char]);
}

async function drawEmoji(doc, element) {
  const size = Math.min(72, Math.max(12, element.size || 32));
  const pixelSize = Math.ceil(size * 2.2);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}">
      <text x="50%" y="78%" text-anchor="middle" font-size="${Math.round(size * 1.8)}"
        font-family="Apple Color Emoji, Noto Color Emoji, Segoe UI Emoji, sans-serif">${escapeXml(element.text)}</text>
    </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const width = size * 1.2;
  doc.image(buffer, element.x * PAGE_WIDTH - width / 2, element.y * PAGE_HEIGHT - width / 2, {
    width,
    height: width,
  });
}

async function drawPageElements(doc, elements, photosById) {
  for (const element of elements || []) {
    const x = element.x * PAGE_WIDTH;
    const y = element.y * PAGE_HEIGHT;
    try {
      if (element.type === 'text') {
        const fontSize = Math.min(72, Math.max(12, element.size || 28));
        const maxWidth = PAGE_WIDTH * 0.76;
        const title = element.title || element.text || '';
        const description = element.description || '';
        const fonts = {
          sans: { bold: 'Helvetica-Bold', regular: 'Helvetica' },
          serif: { bold: 'Times-Bold', regular: 'Times-Roman' },
          mono: { bold: 'Courier-Bold', regular: 'Courier' },
        };
        const font = fonts[element.font] || fonts.sans;
        const descriptionSize = Math.max(10, fontSize * 0.48);
        doc.font(font.bold).fontSize(fontSize);
        const titleWidth = title ? doc.widthOfString(title) : 0;
        doc.font(font.regular).fontSize(descriptionSize);
        const descriptionWidth = description ? doc.widthOfString(description) : 0;
        const contentWidth = Math.min(maxWidth, Math.max(120, titleWidth, descriptionWidth));
        doc.font(font.bold).fontSize(fontSize);
        const titleHeight = title ? doc.heightOfString(title, { width: contentWidth, align: 'center' }) : 0;
        doc.font(font.regular).fontSize(descriptionSize);
        const descriptionHeight = description
          ? doc.heightOfString(description, { width: contentWidth, align: 'center', lineGap: 2 })
          : 0;
        const textGap = title && description ? Math.max(6, fontSize * 0.22) : 0;
        const attachedPhoto = element.photoId ? photosById[element.photoId] : null;
        const photoWidth = attachedPhoto
          ? PAGE_WIDTH * Math.min(0.68, Math.max(0.16, element.photoSize || 0.36))
          : 0;
        const photoHeight = attachedPhoto
          ? (element.photoShape === 'rounded' ? photoWidth * 0.7 : photoWidth)
          : 0;
        const photoGap = attachedPhoto ? Math.max(10, fontSize * 0.45) : 0;
        const totalHeight = titleHeight + textGap + descriptionHeight + photoGap + photoHeight;
        let cursorY = y - totalHeight / 2;
        const panelWidth = Math.min(PAGE_WIDTH * 0.8, Math.max(contentWidth + 24, photoWidth + 16));
        doc.roundedRect(x - panelWidth / 2, cursorY - 10, panelWidth, totalHeight + 20, 9)
          .fillOpacity(0.86).fill('#ffffff').fillOpacity(1);
        doc.fillColor(element.color || '#3a2415');
        if (title) {
          doc.font(font.bold).fontSize(fontSize).text(title, x - contentWidth / 2, cursorY, {
            width: contentWidth, align: 'center', lineGap: 1,
          });
          cursorY += titleHeight + textGap;
        }
        if (description) {
          doc.font(font.regular).fontSize(descriptionSize).text(description, x - contentWidth / 2, cursorY, {
            width: contentWidth, align: 'center', lineGap: 2,
          });
          cursorY += descriptionHeight;
        }
        if (attachedPhoto) {
          cursorY += photoGap;
          const buffer = await loadBoxBuffer(attachedPhoto, photoWidth, photoHeight);
          const photoX = x - photoWidth / 2;
          doc.save();
          if (element.photoShape === 'circle') {
            doc.circle(x, cursorY + photoHeight / 2, photoWidth / 2).clip();
          } else if (element.photoShape === 'rounded') {
            doc.roundedRect(photoX, cursorY, photoWidth, photoHeight, Math.min(16, photoWidth * 0.06)).clip();
          }
          doc.image(buffer, photoX, cursorY, { width: photoWidth, height: photoHeight });
          doc.restore();
        }
      } else if (element.type === 'emoji') {
        await drawEmoji(doc, element);
      } else if (element.type === 'photo' && photosById[element.photoId]) {
        const width = PAGE_WIDTH * Math.min(0.45, Math.max(0.1, element.size || 0.22));
        const buffer = await loadBoxBuffer(photosById[element.photoId], width, width);
        doc.save();
        doc.roundedRect(x - width / 2 - 4, y - width / 2 - 4, width + 8, width + 8, 7).fill('#ffffff');
        doc.image(buffer, x - width / 2, y - width / 2, { width, height: width });
        doc.restore();
      }
    } catch (err) {
      console.warn(`[pdf] element decoratif ignore (${element.type}):`, err.message);
    }
  }
}

async function drawCoverPage(doc, { title, dateStr, statsStr, coverPhoto }) {
  doc.addPage({ size: 'A4', margin: 0 });

  let textColor = '#3a2415';
  let mutedColor = 'rgba(58, 36, 21, 0.7)';

  if (coverPhoto) {
    try {
      const buffer = await loadBoxBuffer(coverPhoto, PAGE_WIDTH, PAGE_HEIGHT);
      doc.image(buffer, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });

      // Dark gradient at the bottom so the title stays legible over any photo.
      const grad = doc.linearGradient(0, PAGE_HEIGHT * 0.45, 0, PAGE_HEIGHT);
      grad.stop(0, '#000000', 0).stop(1, '#000000', 0.72);
      doc.rect(0, PAGE_HEIGHT * 0.45, PAGE_WIDTH, PAGE_HEIGHT * 0.55).fill(grad);

      textColor = '#ffffff';
      mutedColor = 'rgba(255, 255, 255, 0.78)';
    } catch (err) {
      console.warn(`[pdf] photo de couverture ignoree (${photoPath(coverPhoto)}):`, err.message);
      doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill('#e8c39a');
    }
  } else {
    // No cover chosen: warm gradient matching the site's own look.
    const grad = doc.linearGradient(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    grad.stop(0, '#e8c39a').stop(1, '#c67139');
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(grad);
  }

  doc
    .fillColor(textColor)
    .font('Helvetica-Bold')
    .fontSize(34)
    .text(title, 60, PAGE_HEIGHT - 170, { width: PAGE_WIDTH - 120, align: 'center' });

  doc
    .font('Helvetica')
    .fontSize(14)
    .fillColor(mutedColor)
    .text(dateStr, 60, PAGE_HEIGHT - 118, { width: PAGE_WIDTH - 120, align: 'center' });

  doc
    .fontSize(12)
    .fillColor(mutedColor)
    .text(statsStr, 60, PAGE_HEIGHT - 96, { width: PAGE_WIDTH - 120, align: 'center' });
}

// Renders a frozen layout (see layoutPlanner.buildLayout) to disk. `pages`
// and `coverPhoto` are expected to already carry any manual crop_x/crop_y
// the admin picked in the preview screen, so what was shown on screen is
// exactly what ends up in the PDF.
export async function generateAlbumPdf({ title, coverPhoto, pages, photosById, participantCount }) {
  const totalPhotos = pages.reduce((n, p) => n + p.photoIds.filter(Boolean).length, 0);

  const doc = new PDFDocument({ autoFirstPage: false });
  const stream = fs.createWriteStream(PDF_PATH);
  doc.pipe(stream);

  const dateStr = new Date().toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const statsStr = `${totalPhotos} photo${totalPhotos > 1 ? 's' : ''} • ${participantCount} participant${participantCount > 1 ? 's' : ''}`;

  await drawCoverPage(doc, { title: title || 'Notre Album de Voyage', dateStr, statsStr, coverPhoto });

  let contentPageCount = 0;
  for (const page of pages) {
    const photos = page.photoIds.map((id) => id ? photosById[id] || null : null);

    doc.addPage({ size: 'A4', margin: 0 });
    contentPageCount++;
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(page.backgroundColor || '#ffffff');

    if (page.type === 'feature') {
      await drawFeaturePage(doc, photos[0]);
    } else if (page.type === 'quad') {
      await drawQuadPage(doc, photos);
    } else {
      await drawSixPage(doc, photos);
    }
    await drawPageElements(doc, page.elements, photosById);
  }

  if (totalPhotos === 0) {
    doc.addPage({ size: 'A4', margin: 0 });
    contentPageCount++;
    doc
      .font('Helvetica')
      .fontSize(16)
      .fillColor('#333333')
      .text('Aucune photo pour le moment.', 60, PAGE_HEIGHT / 2, {
        width: PAGE_WIDTH - 120,
        align: 'center',
      });
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { photoCount: totalPhotos, pageCount: 1 + contentPageCount };
}
