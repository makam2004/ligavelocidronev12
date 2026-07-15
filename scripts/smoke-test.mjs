import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 18080;
const baseUrl = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    ADMIN_KEY: 'test-admin-key',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // seguir intentando
    }
    await delay(250);
  }
  throw new Error('El servidor no arrancó a tiempo para la prueba.');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { response, data };
}

try {
  await waitUntilReady();

  const health = await fetchJson(`${baseUrl}/api/health`);
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.configured.adminKey, true);
  assert.equal(health.data.timezone, 'Europe/Madrid');
  assert.ok(health.data.now_spain);

  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /Liga Velocidrone/i);
  assert.match(homeHtml, /Alta de nuevo piloto/i);
  assert.doesNotMatch(homeHtml, /Panel admin/i);

  const signupPage = await fetch(`${baseUrl}/alta-piloto`);
  assert.equal(signupPage.status, 200);
  const signupHtml = await signupPage.text();
  assert.match(signupHtml, /Alta de nuevo piloto/i);

  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Panel de administración/i);
  assert.match(adminHtml, /Solicitudes y estado de pilotos/i);

  const registrationWithoutSupabase = await fetchJson(`${baseUrl}/api/pilots/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Pilot' })
  });
  assert.equal(registrationWithoutSupabase.response.status, 503);

  const unauthorizedPilots = await fetchJson(`${baseUrl}/api/admin/pilots`, {
    headers: { 'x-admin-key': 'wrong-key' }
  });
  assert.equal(unauthorizedPilots.response.status, 401);

  const unauthorizedSave = await fetchJson(`${baseUrl}/api/admin/tracks/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', is_official: true, track_id: 10, laps: 1, active: true })
  });
  assert.equal(unauthorizedSave.response.status, 401);

  const authorizedWithoutSupabase = await fetchJson(`${baseUrl}/api/admin/tracks/upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': 'test-admin-key'
    },
    body: JSON.stringify({ name: 'Test', is_official: true, track_id: 10, laps: 1, active: true })
  });
  assert.equal(authorizedWithoutSupabase.response.status, 503);

  const unauthorizedWeeklyAward = await fetchJson(`${baseUrl}/api/admin/rankings/award-weekly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ season_year: 2026, week_key: '2026-W11' })
  });
  assert.equal(unauthorizedWeeklyAward.response.status, 401);

  const telegramStatus = await fetchJson(`${baseUrl}/api/telegram/status`);
  assert.equal(telegramStatus.response.status, 200);
  assert.equal(telegramStatus.data.hasWebhookSecret, true);
  assert.equal(telegramStatus.data.improvementMonitor.enabled, false);

  const unauthorizedImprovementCheck = await fetchJson(`${baseUrl}/api/admin/telegram/check-improvements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notify: false })
  });
  assert.equal(unauthorizedImprovementCheck.response.status, 401);

  const invalidWebhook = await fetchJson(`${baseUrl}/api/telegram/webhook/bad-secret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(invalidWebhook.response.status, 401);

  console.log('\n✅ Smoke test completado correctamente.');
} finally {
  child.kill('SIGTERM');
}
