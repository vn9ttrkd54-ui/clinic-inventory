import { chmod, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InputError } from './inventory.mjs';

export const responseSecurityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

// These checks protect the local prototype. They do not identify a staff member.
export function requestDenied(request, port) {
  const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(request.headers.host)) {
    return 'This preview is available on localhost only.';
  }
  const url = new URL(request.url, origins[0]);
  if (!url.pathname.startsWith('/api/')) return null;
  const origin = request.headers.origin;
  const site = request.headers['sec-fetch-site'];
  if ((origin !== undefined && !origins.includes(origin)) ||
      (site !== undefined && !['same-origin', 'none'].includes(site))) {
    return 'Open the inventory directly to access its records.';
  }
  if (request.method === 'POST' && request.headers['x-clinic-request'] !== '1') {
    return 'Please submit changes from the local inventory page.';
  }
  return null;
}

export async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 65536) throw new InputError('This request is too large.');
    chunks.push(bytes);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('The submitted data could not be read.'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new InputError('Please submit a JSON object.');
  }
  return body;
}

export async function secureDataDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!/\.sqlite(?:-(?:journal|wal|shm))?$/.test(entry.name)) continue;
    if (!entry.isFile()) throw new Error('Inventory database paths must be regular files.');
    await chmod(join(directory, entry.name), 0o600);
  }
}
