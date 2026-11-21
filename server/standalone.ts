/**
 * Serwer produkcyjny: pliki zbudowanej aplikacji (dist/) + API.
 * Uruchomienie: npm run build && npm start  →  http://localhost:4173
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createApiHandler } from './api';

const PORT = Number(process.env.PORT ?? 4173);
const DIST = join(process.cwd(), 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const api = createApiHandler();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    await api(req, res);
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (relative.includes('..')) {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }
  let file = join(DIST, relative || 'index.html');
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html');
  }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file)
    .on('error', () => {
      res.statusCode = 404;
      res.end('Nie znaleziono pliku. Uruchom najpierw: npm run build');
    })
    .pipe(res);
});

server.listen(PORT, () => {
  console.log(`Kropla w Polu: http://localhost:${PORT}`);
});
