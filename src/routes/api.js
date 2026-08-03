import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import db from '../db.js';
import { UPLOADS_DIR, THUMBS_DIR, PDF_PATH, ZIP_PATH } from '../paths.js';
import { generateAlbumPdf } from '../services/pdfGenerator.js';
import { generateZip } from '../services/zipGenerator.js';
import { buildLayout, seedAutoCrop, planPageSizes, PAGE_WIDTH, PAGE_HEIGHT } from '../services/layoutPlanner.js';
import {
  getEmailStatus,
  sendAlbumEmails,
  sendReminderEmails,
  sendTestEmail,
  verifyEmailConfiguration,
} from '../services/mailer.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARTICIPANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff']);

// ---- config ----
router.get('/config', (req, res) => {
  res.json({ tripName: process.env.TRIP_NAME || 'Notre Voyage' });
});

// ---- register ----
router.post('/register', (req, res) => {
  const { name, email } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Le nom est requis.' });
  }
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "L'email n'est pas valide." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim().slice(0, 100);

  const existing = db.prepare('SELECT id, name FROM participants WHERE email = ?').get(cleanEmail);
  if (existing) {
    if (existing.name !== cleanName) {
      db.prepare('UPDATE participants SET name = ? WHERE id = ?').run(cleanName, existing.id);
    }
    return res.json({ id: existing.id, name: cleanName });
  }

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO participants (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    cleanName,
    cleanEmail,
    new Date().toISOString()
  );

  res.json({ id, name: cleanName });
});

// ---- upload ----
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const participantId = req.body.participantId;
    if (!PARTICIPANT_ID_RE.test(participantId || '')) return cb(new Error('Participant invalide.'));
    const dir = path.join(UPLOADS_DIR, participantId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10) || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 40 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Seules les images sont acceptees'));
    }
    cb(null, true);
  },
});

router.post('/upload', (req, res) => {
  upload.array('photos', 40)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: friendlyUploadError(err) });
    }

    const participantId = req.body.participantId;
    const participant = db.prepare('SELECT id FROM participants WHERE id = ?').get(participantId);
    if (!participant) {
      await Promise.all((req.files || []).map((file) => fs.promises.rm(file.path, { force: true })));
      return res.status(400).json({ error: 'Participant inconnu. Reinscrivez-vous.' });
    }

    const files = req.files || [];
    const insert = db.prepare(
      'INSERT INTO photos (id, participant_id, filename, original_name, content_hash, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const inserted = [];
    const rejected = [];
    for (const file of files) {
      try {
        const metadata = await sharp(file.path, { limitInputPixels: 80_000_000 }).metadata();
        if (!metadata.width || !metadata.height || !ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
          throw new Error('format non pris en charge');
        }
        const contentHash = await hashFile(file.path);
        const duplicate = db.prepare(
          'SELECT id FROM photos WHERE participant_id = ? AND content_hash = ?'
        ).get(participantId, contentHash);
        if (duplicate) {
          await fs.promises.rm(file.path, { force: true });
          rejected.push({ name: file.originalname, reason: 'déjà envoyée' });
          continue;
        }

        const id = crypto.randomUUID();
        insert.run(id, participantId, file.filename, file.originalname.slice(0, 255), contentHash, new Date().toISOString());
        inserted.push({ id, filename: file.filename, originalName: file.originalname });
      } catch (error) {
        await fs.promises.rm(file.path, { force: true });
        rejected.push({ name: file.originalname, reason: error.message || 'image illisible' });
      }
    }

    if (!inserted.length && rejected.length) {
      return res.status(400).json({ error: 'Aucune image valide à enregistrer.', rejected });
    }
    res.json({ uploaded: inserted.length, photos: inserted, rejected });
  });
});

function friendlyUploadError(error) {
  if (error?.code === 'LIMIT_FILE_SIZE') return 'Une photo dépasse la taille maximale de 25 Mo.';
  if (error?.code === 'LIMIT_FILE_COUNT') return 'Vous pouvez envoyer au maximum 40 photos à la fois.';
  return error?.message || "L'envoi des photos a échoué.";
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

// ---- list photos for a participant ----
router.get('/participant/:id/photos', (req, res) => {
  const photos = db
    .prepare('SELECT id, filename, original_name AS originalName FROM photos WHERE participant_id = ? ORDER BY uploaded_at DESC')
    .all(req.params.id);
  res.json({ photos });
});

// ---- delete a photo ----
router.delete('/photo/:id', (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo introuvable.' });

  const filePath = path.join(UPLOADS_DIR, photo.participant_id, photo.filename);
  fs.rm(filePath, { force: true }, () => {});
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);

  res.json({ ok: true });
});

// ---- lightweight cached thumbnail for photo pickers ----
// ?mode=full returns the whole photo (proportional, not cropped) at a
// moderate resolution, for the crop-adjustment screen: the browser needs
// the entire frame to let the admin click anywhere to recenter it.
router.get('/thumb/:photoId', async (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.photoId);
  if (!photo) return res.status(404).end();

  const full = req.query.mode === 'full';
  const thumbPath = path.join(THUMBS_DIR, `${photo.id}${full ? '-full' : ''}.jpg`);
  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  const sourcePath = path.join(UPLOADS_DIR, photo.participant_id, photo.filename);
  try {
    const buffer = full
      ? await sharp(sourcePath)
          .rotate()
          .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer()
      : await sharp(sourcePath)
          .rotate()
          .resize(320, 320, { fit: 'cover', position: sharp.strategy.attention })
          .jpeg({ quality: 75 })
          .toBuffer();
    fs.writeFileSync(thumbPath, buffer);
    res.set('Content-Type', 'image/jpeg').send(buffer);
  } catch (err) {
    res.status(500).end();
  }
});

// ---- set a photo's manual crop, zoom and display mode ----
router.patch('/photo/:id/crop', (req, res) => {
  const { x, y, zoom = 1, mode = 'cover' } = req.body || {};
  if (
    typeof x !== 'number' || typeof y !== 'number' ||
    x < 0 || x > 1 || y < 0 || y > 1 ||
    typeof zoom !== 'number' || zoom < 1 || zoom > 3 ||
    !['cover', 'contain'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Coordonnees de cadrage invalides.' });
  }

  const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo introuvable.' });

  db.prepare('UPDATE photos SET crop_x = ?, crop_y = ?, crop_zoom = ?, crop_mode = ? WHERE id = ?')
    .run(x, y, zoom, mode, req.params.id);
  db.prepare('UPDATE album SET generated_at = NULL, sent_at = NULL WHERE id = 1').run();
  res.json({ ok: true });
});

// ---- admin: every photo, for the cover-photo picker ----
router.get('/admin/all-photos', (req, res) => {
  const photos = db
    .prepare(
      `SELECT photos.id, participants.name AS participantName
       FROM photos
       JOIN participants ON participants.id = photos.participant_id
       ORDER BY photos.uploaded_at DESC`
    )
    .all();
  res.json({ photos });
});

// ---- admin: status ----
router.get('/admin/status', (req, res) => {
  const participants = db
    .prepare(
      `SELECT participants.id, participants.name, participants.email,
              COUNT(photos.id) AS photoCount,
              MAX(photos.uploaded_at) AS lastUploadAt
       FROM participants
       LEFT JOIN photos ON photos.participant_id = participants.id
       GROUP BY participants.id
       ORDER BY participants.created_at`
    )
    .all();

  const totals = db.prepare('SELECT COUNT(*) AS c FROM photos').get();
  const album = db.prepare('SELECT * FROM album WHERE id = 1').get();
  if (album?.layout_json && normalizeStoredLayout(album).changed) {
    album.generated_at = null;
    album.sent_at = null;
  }
  const participated = participants.filter((p) => p.photoCount > 0).length;

  res.json({
    participants,
    totalPhotos: totals.c,
    participated,
    pending: participants.length - participated,
    album: album || null,
  });
});

function getPhotoDetails(id) {
  const p = db
    .prepare(
      `SELECT photos.*, participants.name AS participant_name
       FROM photos JOIN participants ON participants.id = photos.participant_id
       WHERE photos.id = ?`
    )
    .get(id);
  if (!p) return null;
  return {
    id: p.id,
    participantId: p.participant_id,
    participantName: p.participant_name,
    filename: p.filename,
    url: `/uploads/${p.participant_id}/${p.filename}`,
    cropX: p.crop_x,
    cropY: p.crop_y,
    cropZoom: p.crop_zoom ?? 1,
    cropMode: p.crop_mode || 'cover',
  };
}

function cleanNumber(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function cleanColor(value, fallback = '#ffffff') {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function sanitizeElements(elements, allowedPhotoIds = null) {
  if (!Array.isArray(elements)) return [];
  return elements.slice(0, 40).flatMap((element) => {
    if (!element || !['text', 'emoji', 'photo'].includes(element.type)) return [];
    const base = {
      id: typeof element.id === 'string' ? element.id.slice(0, 80) : crypto.randomUUID(),
      type: element.type,
      x: cleanNumber(element.x, 0.5, 0.03, 0.97),
      y: cleanNumber(element.y, 0.25, 0.03, 0.97),
      size: cleanNumber(element.size, element.type === 'photo' ? 0.22 : 28, element.type === 'photo' ? 0.1 : 12, element.type === 'photo' ? 0.45 : 72),
    };
    if (element.type === 'text') {
      const title = String(element.title || element.text || '').trim().slice(0, 120);
      const description = String(element.description || '').trim().slice(0, 360);
      if (!title && !description) return [];
      const font = ['sans', 'serif', 'mono'].includes(element.font) ? element.font : 'sans';
      const photoId = typeof element.photoId === 'string' && (!allowedPhotoIds || allowedPhotoIds.has(element.photoId))
        ? element.photoId
        : null;
      const photoShape = ['rounded', 'square', 'circle'].includes(element.photoShape) ? element.photoShape : 'rounded';
      return [{
        ...base,
        title,
        description,
        font,
        color: cleanColor(element.color, '#3a2415'),
        ...(photoId ? {
          photoId,
          photoSize: cleanNumber(element.photoSize, 0.36, 0.16, 0.68),
          photoShape,
        } : {}),
      }];
    }
    if (element.type === 'emoji') {
      const text = String(element.text || '').trim().slice(0, 24);
      if (!text) return [];
      return [{ ...base, text }];
    }
    if (typeof element.photoId !== 'string' || (allowedPhotoIds && !allowedPhotoIds.has(element.photoId))) return [];
    return [{ ...base, photoId: element.photoId }];
  });
}

function normalizeStoredLayout(album) {
  const pages = JSON.parse(album.layout_json);
  const expectedCounts = { feature: 1, quad: 4, six: 6 };
  const valid = pages.every((page) => (
    expectedCounts[page.type] === page.photoIds?.length
  ));
  if (valid) return { pages, changed: false };

  const photoIds = pages.flatMap((page) => page.photoIds || []).filter(Boolean);
  let offset = 0;
  const normalized = planPageSizes(photoIds.length).map((size, pageIndex) => {
    const page = {
      type: size === 1 ? 'feature' : size === 4 ? 'quad' : 'six',
      photoIds: photoIds.slice(offset, offset + size),
      elements: sanitizeElements(pages[pageIndex]?.elements),
      backgroundColor: cleanColor(pages[pageIndex]?.backgroundColor),
    };
    offset += size;
    return page;
  });

  db.prepare(
    'UPDATE album SET layout_json = ?, generated_at = NULL, sent_at = NULL WHERE id = 1'
  ).run(JSON.stringify(normalized));
  return { pages: normalized, changed: true };
}

function getFullLayout() {
  const album = db.prepare('SELECT * FROM album WHERE id = 1').get();
  if (!album || !album.layout_json) return null;

  const normalized = normalizeStoredLayout(album);
  const pages = normalized.pages.map((page) => ({
    type: page.type,
    photos: page.photoIds.map((id) => id ? getPhotoDetails(id) : null),
    elements: sanitizeElements(page.elements),
    backgroundColor: cleanColor(page.backgroundColor),
  }));

  return {
    title: album.title,
    cover: album.cover_photo_id ? getPhotoDetails(album.cover_photo_id) : null,
    pages,
    excludedPhotos: JSON.parse(album.excluded_photo_ids || '[]').map(getPhotoDetails).filter(Boolean),
    generated: normalized.changed ? false : Boolean(album.generated_at),
  };
}

// ---- admin: freeze a new random layout (shuffle + page assignment), no rendering yet ----
router.post('/admin/prepare', async (req, res) => {
  const title = (req.body?.title || process.env.TRIP_NAME || 'Notre Album de Voyage').trim();
  const coverPhotoId = req.body?.coverPhotoId || null;

  const photos = db.prepare('SELECT id, participant_id, filename FROM photos').all();
  if (photos.length === 0) {
    return res.status(400).json({ error: "Aucune photo n'a encore ete deposee." });
  }

  try {
    const pages = await buildLayout(photos);

    if (coverPhotoId) {
      const coverRow = db.prepare('SELECT id, participant_id, filename FROM photos WHERE id = ?').get(coverPhotoId);
      if (coverRow) await seedAutoCrop(coverRow, PAGE_WIDTH, PAGE_HEIGHT);
    }

    db.prepare(
      `INSERT INTO album (id, title, cover_photo_id, layout_json, excluded_photo_ids, pdf_path, zip_path, photo_count, participant_count, page_count, generated_at, sent_at, recipient_count, recipient_names)
       VALUES (1, ?, ?, ?, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         cover_photo_id = excluded.cover_photo_id,
         layout_json = excluded.layout_json,
         excluded_photo_ids = '[]',
         pdf_path = NULL,
         zip_path = NULL,
         photo_count = NULL,
         participant_count = NULL,
         page_count = NULL,
         generated_at = NULL,
         sent_at = NULL,
         recipient_count = NULL,
         recipient_names = NULL`
    ).run(title, coverPhotoId, JSON.stringify(pages));

    res.json({ success: true, ...getFullLayout() });
  } catch (err) {
    console.error('[admin/prepare]', err);
    res.status(500).json({ error: "La preparation de l'album a echoue: " + err.message });
  }
});

// ---- admin: read back the frozen layout (e.g. on preview page reload) ----
router.get('/admin/layout', (req, res) => {
  const layout = getFullLayout();
  if (!layout) return res.json({ ready: false });
  res.json({ ready: true, ...layout });
});

// ---- admin: persist manual photo order and page formats ----
router.patch('/admin/layout', (req, res) => {
  const album = db.prepare('SELECT layout_json, excluded_photo_ids, cover_photo_id FROM album WHERE id = 1').get();
  if (!album?.layout_json) {
    return res.status(400).json({ error: "Preparez d'abord l'album." });
  }

  const pages = req.body?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'Mise en page invalide.' });
  }

  const currentActiveIds = JSON.parse(album.layout_json).flatMap((page) => page.photoIds).filter(Boolean);
  const currentExcludedIds = JSON.parse(album.excluded_photo_ids || '[]').filter((id) => typeof id === 'string');
  const currentIds = [...new Set([...currentActiveIds, ...currentExcludedIds])].sort();
  const nextIds = pages.flatMap((page) => Array.isArray(page.photoIds) ? page.photoIds : []).filter(Boolean).sort();
  const nextExcludedIds = Array.isArray(req.body?.excludedPhotoIds)
    ? [...new Set(req.body.excludedPhotoIds.filter((id) => typeof id === 'string'))].sort()
    : currentExcludedIds.slice().sort();
  const nextAllIds = [...nextIds, ...nextExcludedIds].sort();
  const allowedPhotoIds = new Set(currentIds);
  const allowedCounts = { feature: 1, quad: 4, six: 6 };
  const validPages = pages.every((page) => (
    Object.hasOwn(allowedCounts, page.type) &&
    Array.isArray(page.photoIds) &&
    page.photoIds.length === allowedCounts[page.type] &&
    page.photoIds.every((id) => id === null || typeof id === 'string')
  ));
  const noOverlap = !nextIds.some((id) => nextExcludedIds.includes(id));
  const samePhotos = currentIds.length === nextAllIds.length && currentIds.every((id, i) => id === nextAllIds[i]);

  if (!validPages || !samePhotos || !noOverlap) {
    return res.status(400).json({ error: 'La mise en page ne contient pas les bonnes photos.' });
  }

  const cleanPages = pages.map((page) => ({
    type: page.type,
    photoIds: page.photoIds,
    elements: sanitizeElements(page.elements, allowedPhotoIds),
    backgroundColor: cleanColor(page.backgroundColor),
  }));

  db.prepare(
    'UPDATE album SET layout_json = ?, excluded_photo_ids = ?, generated_at = NULL, sent_at = NULL WHERE id = 1'
  ).run(JSON.stringify(cleanPages), JSON.stringify(nextExcludedIds));
  if (album.cover_photo_id && nextExcludedIds.includes(album.cover_photo_id)) {
    db.prepare('UPDATE album SET cover_photo_id = NULL WHERE id = 1').run();
  }
  res.json({ ok: true, ...getFullLayout() });
});

// ---- admin: render the frozen layout to PDF + ZIP (no email yet) ----
router.post('/admin/generate', async (req, res) => {
  const album = db.prepare('SELECT * FROM album WHERE id = 1').get();
  if (!album || !album.layout_json) {
    return res.status(400).json({ error: "Preparez d'abord l'album (bouton \"Creer l'album\")." });
  }

  try {
    const pages = normalizeStoredLayout(album).pages;
    const photoIds = new Set(pages.flatMap((p) => p.photoIds).filter(Boolean));
    pages.flatMap((page) => page.elements || [])
      .filter((element) => element.photoId)
      .forEach((element) => photoIds.add(element.photoId));
    if (album.cover_photo_id) photoIds.add(album.cover_photo_id);

    const photosById = {};
    for (const id of photoIds) {
      const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
      if (row) photosById[id] = row;
    }
    const coverPhoto = album.cover_photo_id ? photosById[album.cover_photo_id] || null : null;
    const participantCount = db.prepare('SELECT COUNT(*) AS c FROM participants').get().c;

    const { photoCount, pageCount } = await generateAlbumPdf({
      title: album.title,
      coverPhoto,
      pages,
      photosById,
      participantCount,
    });
    await generateZip();

    const generatedAt = new Date().toISOString();
    db.prepare(
      `UPDATE album SET pdf_path = ?, zip_path = ?, photo_count = ?, participant_count = ?, page_count = ?, generated_at = ?, sent_at = NULL, recipient_count = NULL, recipient_names = NULL
       WHERE id = 1`
    ).run(PDF_PATH, ZIP_PATH, photoCount, participantCount, pageCount, generatedAt);

    res.json({ success: true, title: album.title, photoCount, participantCount, pageCount, generatedAt });
  } catch (err) {
    console.error('[admin/generate]', err);
    res.status(500).json({ error: "La generation de l'album a echoue: " + err.message });
  }
});

// ---- admin: send the generated album to everyone ----
router.post('/admin/send', async (req, res) => {
  const album = db.prepare('SELECT * FROM album WHERE id = 1').get();
  if (!album || !album.generated_at) {
    return res.status(400).json({ error: "Aucun album genere. Cliquez d'abord sur \"Generer le PDF\"." });
  }

  const participants = db.prepare('SELECT name, email FROM participants').all();
  const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const albumUrl = `${baseUrl}/album.html`;

  const emailResult = await sendAlbumEmails(participants, { title: album.title, albumUrl });

  if (!emailResult.configured) {
    return res.status(503).json({ error: 'Configurez le serveur SMTP avant l’envoi.', email: emailResult });
  }
  if (!emailResult.sent) {
    return res.status(502).json({ error: 'Aucun email n’a pu être envoyé. Vérifiez la configuration SMTP.', email: emailResult });
  }

  const sentAt = new Date().toISOString();
  db.prepare(
    'UPDATE album SET sent_at = ?, recipient_count = ?, recipient_names = ? WHERE id = 1'
  ).run(sentAt, emailResult.sent, JSON.stringify(emailResult.sentRecipients.map((p) => p.name)));

  res.status(emailResult.failed ? 207 : 200).json({ success: true, sentAt, email: emailResult });
});

router.get('/admin/email-status', async (req, res) => {
  if (req.query.verify !== 'true') return res.json(getEmailStatus());
  res.json(await verifyEmailConfiguration());
});

router.post('/admin/email-test', async (req, res) => {
  const to = String(req.body?.email || getEmailStatus().fromEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Indiquez une adresse email de test valide.' });
  const result = await sendTestEmail(to);
  if (!result.configured) return res.status(503).json({ error: 'Configuration SMTP incomplète.', ...result });
  if (!result.sent) return res.status(502).json({ error: result.errors[0]?.error || "L'email de test a échoué.", ...result });
  res.json(result);
});

// ---- admin: remind participants who haven't uploaded anything yet ----
router.post('/admin/remind', async (req, res) => {
  const pending = db
    .prepare(
      `SELECT participants.name, participants.email
       FROM participants
       LEFT JOIN photos ON photos.participant_id = participants.id
       GROUP BY participants.id
       HAVING COUNT(photos.id) = 0`
    )
    .all();

  if (pending.length === 0) {
    return res.json({ configured: true, sent: 0, failed: 0, errors: [], noPending: true });
  }

  const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const tripName = process.env.TRIP_NAME || 'Notre Voyage';

  const result = await sendReminderEmails(pending, { tripName, homeUrl: `${baseUrl}/` });
  res.json(result);
});

// ---- public album status ----
router.get('/album/status', (req, res) => {
  const album = db.prepare('SELECT * FROM album WHERE id = 1').get();
  if (!album || !album.generated_at) return res.json({ ready: false });

  let coverPhotoUrl = null;
  if (album.cover_photo_id) {
    const cover = db.prepare('SELECT participant_id, filename FROM photos WHERE id = ?').get(album.cover_photo_id);
    if (cover) coverPhotoUrl = `/uploads/${cover.participant_id}/${cover.filename}`;
  }

  res.json({
    ready: true,
    sent: Boolean(album.sent_at),
    title: album.title,
    photoCount: album.photo_count,
    participantCount: album.participant_count,
    pageCount: album.page_count,
    generatedAt: album.generated_at,
    sentAt: album.sent_at,
    recipientCount: album.recipient_count,
    recipientNames: album.recipient_names ? JSON.parse(album.recipient_names) : [],
    coverPhotoUrl,
  });
});

export default router;
