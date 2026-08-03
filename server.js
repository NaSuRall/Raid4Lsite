import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './src/routes/api.js';
import { UPLOADS_DIR, GENERATED_DIR, THUMBS_DIR, PDF_PATH, ZIP_PATH } from './src/paths.js';
import './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(GENERATED_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api', apiRouter);

app.get('/download/album.pdf', (req, res) => {
  if (!fs.existsSync(PDF_PATH)) return res.status(404).send("L'album n'a pas encore ete genere.");
  res.download(PDF_PATH, 'album.pdf');
});

app.get('/download/photos.zip', (req, res) => {
  if (!fs.existsSync(ZIP_PATH)) return res.status(404).send("Le zip n'a pas encore ete genere.");
  res.download(ZIP_PATH, 'photos.zip');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Album Voyage lance sur http://localhost:${PORT}`);
});
