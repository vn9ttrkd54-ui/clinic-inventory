import assert from 'node:assert/strict';
import { request } from 'node:http';

// Deliberately restricted to this app's loopback server; never targets a remote site.
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid local port.');
const origin = `http://localhost:${port}`;
const checks = [];

function send(path, {method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const req = request({hostname:'127.0.0.1',port,path,method,headers:{Host:`localhost:${port}`,...headers}}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));
      response.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Local security check timed out.')));
    req.on('error', reject);
    req.end(body);
  });
}
async function check(label, path, options, status) {
  const response = await send(path, options);
  assert.equal(response.status, status, label);
  if (status === 403) assert.ok(!response.body.includes('"items"'), `${label}: inventory not disclosed`);
  checks.push(label);
  return response;
}

const before = await Promise.all(['clinic','demo'].map(workspace => send(`/api/state?workspace=${workspace}`)));
const page = await check('Dashboard loads', '/', {}, 200);
for (const name of ['content-security-policy','x-frame-options','referrer-policy','cross-origin-resource-policy','permissions-policy','x-content-type-options']) {
  assert.ok(page.headers[name], `${name} header present`);
}
assert.equal(page.headers['cache-control'], 'no-store');
await check('Local API loads', '/api/state?workspace=demo', {}, 200);
await check('Foreign-origin reads denied', '/api/state', {headers:{Origin:'https://unapproved.example'}}, 403);
await check('Cross-site browser reads denied', '/api/state', {headers:{'Sec-Fetch-Site':'cross-site'}}, 403);
await check('Unexpected hostname denied', '/api/state', {headers:{Host:`unapproved.example:${port}`}}, 403);
await check('Write without request header denied', '/api/items', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}, 403);
const headers = {'Content-Type':'application/json','X-Clinic-Request':'1',Origin:origin};
await check('Foreign-origin writes denied', '/api/items', {method:'POST',headers:{...headers,Origin:'https://unapproved.example'},body:'{}'}, 403);
for (const body of ['null','[]','{']) {
  await check(`Invalid JSON body ${body} rejected`, '/api/items', {method:'POST',headers,body}, 400);
}
await check('Oversized body rejected', '/api/items', {method:'POST',headers,body:' '.repeat(65537)}, 400);
for (const path of ['/data/inventory.sqlite','/server.mjs','/security.mjs','/.git/config']) {
  await check(`Private file ${path} unavailable`, path, {}, 404);
}
await check('Encoded traversal denied', '/%2e%2e%2fdata%2finventory.sqlite', {}, 403);
await check('Malformed path rejected', '/%ZZ', {}, 400);
await check('Unsupported method denied', '/', {method:'TRACE'}, 405);
const after = await Promise.all(['clinic','demo'].map(workspace => send(`/api/state?workspace=${workspace}`)));
assert.ok(before.every((entry,index) => entry.status === 200 && after[index].status === 200 && entry.body === after[index].body), 'Security checks must leave both inventories unchanged.');
console.log(`${checks.length} local HTTP security checks passed; both inventories are unchanged.`);
console.log('This checks the local prototype, not staff authentication or a hosted deployment.');
