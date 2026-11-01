import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestDenied, readJson, secureDataDirectory } from '../security.mjs';

const request = (headers = {}, method = 'GET', url = '/api/state') => ({
  method, url, headers: {host:'localhost:3001', ...headers},
});

test('unexpected hostnames and browser cross-site API reads are refused', () => {
  for (const headers of [
    {host:'attacker.example:3001'},
    {origin:'https://attacker.example'},
    {origin:'null'},
    {'sec-fetch-site':'cross-site'},
    {'sec-fetch-site':'same-site'},
  ]) assert.ok(requestDenied(request(headers), 3001));
  assert.equal(requestDenied(request({'sec-fetch-site':'same-origin'}), 3001), null);
  assert.equal(requestDenied(request({'sec-fetch-site':'none'}), 3001), null);
});

test('cross-site writes cannot pass by supplying the app header', () => {
  assert.ok(requestDenied(request({'x-clinic-request':'1',origin:'https://attacker.example'}, 'POST'), 3001));
  assert.ok(requestDenied(request({}, 'POST'), 3001));
  assert.equal(requestDenied(request({'x-clinic-request':'1',origin:'http://localhost:3001','sec-fetch-site':'same-origin'}, 'POST'), 3001), null);
  assert.equal(requestDenied(request({host:'127.0.0.1:3001','x-clinic-request':'1',origin:'http://127.0.0.1:3001'}, 'POST'), 3001), null);
});

test('malformed JSON and non-object bodies are rejected before reaching inventory writes', async () => {
  for (const body of ['{', 'null', '[]', 'true', '1', '"text"']) {
    await assert.rejects(readJson(Readable.from([body])), /JSON object|could not be read/);
  }
  assert.deepEqual(await readJson(Readable.from(['{"quantity":12}'])), {quantity:12});
});

test('body size uses received bytes and split Unicode characters remain intact', async () => {
  await assert.rejects(readJson(Readable.from([Buffer.alloc(65537, 32)])), /too large/);
  const bytes = Buffer.from('{"name":"Gloves 🧤"}');
  const emoji = bytes.indexOf(Buffer.from('🧤'));
  assert.deepEqual(await readJson(Readable.from([bytes.subarray(0,emoji+1),bytes.subarray(emoji+1)])), {name:'Gloves 🧤'});
});

test('existing database permissions are tightened without changing their contents', async () => {
  const directory = await mkdtemp(join(tmpdir(),'clinic-security-'));
  try {
    const database = join(directory,'inventory.sqlite');
    await writeFile(database,'sample-only',{mode:0o644});
    await secureDataDirectory(directory);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(database)).mode & 0o777, 0o600);
    assert.equal(await readFile(database,'utf8'),'sample-only');
  } finally { await rm(directory,{recursive:true,force:true}); }
});
