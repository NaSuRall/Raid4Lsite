import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const GENERATED_DIR = path.join(DATA_DIR, 'generated');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbnails');
export const PDF_PATH = path.join(GENERATED_DIR, 'album.pdf');
export const ZIP_PATH = path.join(GENERATED_DIR, 'photos.zip');
