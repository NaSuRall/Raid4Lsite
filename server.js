import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './src/routes/api.js';
import { protectAdmin } from './src/adminAuth.js';
import { UPLOADS_DIR, GENERATED_DIR, THUMBS_DIR, PDF_PATH, ZIP_PATH } from './src/paths.js';
import './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(GENERATED_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(['/admin.html', '/preview.html', '/api/admin'], protectAdmin);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api', apiRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

app.get('/download/album.pdf', (req, res) => {
  if (!fs.existsSync(PDF_PATH)) return res.status(404).send("L'album n'a pas encore ete genere.");
  res.download(PDF_PATH, 'album.pdf');
});

app.get('/download/photos.zip', (req, res) => {
  if (!fs.existsSync(ZIP_PATH)) return res.status(404).send("Le zip n'a pas encore ete genere.");
  res.download(ZIP_PATH, 'photos.zip');
});

const PORT = Number(process.env.PORT || 3000);
const server = app.listen(PORT, () => {
  console.log(`La traversée des Alpes RAID 2026 lancée sur http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} recu, arret en cours...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
