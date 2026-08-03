import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db.js';
import { ZIP_PATH, UPLOADS_DIR } from '../paths.js';

function sanitizeFolderName(name) {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'participant';
}

export async function generateZip() {
  const photos = db
    .prepare(
      `SELECT photos.filename, photos.original_name, photos.participant_id, participants.name AS participant_name
       FROM photos
       JOIN participants ON participants.id = photos.participant_id
       ORDER BY participants.name`
    )
    .all();

  const output = fs.createWriteStream(ZIP_PATH);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);

  for (const photo of photos) {
    const filePath = path.join(UPLOADS_DIR, photo.participant_id, photo.filename);
    if (!fs.existsSync(filePath)) continue;
    const folder = sanitizeFolderName(photo.participant_name);
    const name = photo.original_name || photo.filename;
    archive.file(filePath, { name: `${folder}/${name}` });
  }

  await archive.finalize();
  await done;

  return { photoCount: photos.length };
}
