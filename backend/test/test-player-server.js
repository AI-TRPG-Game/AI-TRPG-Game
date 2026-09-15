import assert from 'node:assert/strict';
import { createPlayerApp } from '../src/playerServer.js';
import net from 'node:net';

const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let shutdowns = 0;
let finishRequest;
const app = createPlayerApp({ token: 'test-secret', origin, dist: 'dist', shutdown: () => shutdowns++, llmProvider: {} });
app.get('/api/test-slow', (_req, res) => { finishRequest = () => res.json({ ok: true }); });
const server = app.listen(port, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
try {
  assert.equal((await (await fetch(origin + '/launcher/health')).json()).app, 'ai-trpg-player');
  assert.equal((await fetch(origin + '/launcher/session', { headers: { origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(origin + '/launcher/shutdown', { method: 'POST' })).status, 403);
  const pending = fetch(origin + '/api/test-slow');
  while (!finishRequest) await new Promise(resolve => setTimeout(resolve, 10));
  const stop = () => fetch(origin + '/launcher/shutdown', { method: 'POST', headers: { 'x-launcher-token': 'test-secret', origin } });
  assert.equal((await stop()).status, 409);
  finishRequest();
  await (await pending).json();
  assert.equal((await stop()).status, 200);
  assert.equal(shutdowns, 1);
  assert.equal((await fetch(origin + '/launcher/health')).status, 503);
  console.log('Player lifecycle checks passed');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
