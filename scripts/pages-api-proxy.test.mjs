import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../artifacts/super-tv/public/_worker.js';

test('relative API calls preserve authorization and reach the VPS rather than the SPA', async t => {
  t.mock.method(globalThis, 'fetch', async (request, options) => {
    assert.equal(request.url, 'https://167-233-103-143.sslip.io/api/channels?token=viewer');
    assert.equal(request.headers.get('Authorization'), 'Bearer viewer');
    assert.equal(request.headers.has('host'), false);
    assert.equal(options.redirect, 'manual');
    return Response.json([{ id: 412 }]);
  });
  const response = await worker.fetch(new Request('https://supertv2.com/api/channels?token=viewer', { headers: { Authorization: 'Bearer viewer', host: 'supertv2.com' } }), {});
  assert.deepEqual(await response.json(), [{ id: 412 }]);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('POST bodies and upstream error status are forwarded intact', async t => {
  t.mock.method(globalThis, 'fetch', async request => {
    assert.equal(request.method, 'POST');
    assert.deepEqual(await request.json(), { code: 'example' });
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  });
  const response = await worker.fetch(new Request('https://supertv2.com/api/auth/login', { method: 'POST', body: JSON.stringify({ code: 'example' }), headers: { 'Content-Type': 'application/json' } }), {});
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
});

test('missing API origins and network failures produce JSON errors, not HTML', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network unavailable'); });
  for (const env of [{}, { VITE_API_URL: 'not a URL' }, { VITE_API_URL: 'https://supertv2.com' }]) {
    const response = await worker.fetch(new Request('https://supertv2.com/api/movies'), env);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
  }
});

test('non-API requests retain Pages asset handling', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected API call'); });
  const request = new Request('https://supertv2.com/home');
  const response = await worker.fetch(request, { ASSETS: { fetch: async r => { assert.equal(r, request); return new Response('static app'); } } });
  assert.equal(await response.text(), 'static app');
});
