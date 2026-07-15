import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfigSummary, config } from './config.js';
import { requireAdmin, isAdminRequest } from './middleware/adminAuth.js';
import {
  listActivePilots,
  listPilots,
  registerPendingPilot,
  updatePilotActiveStatus,
  listTracks,
  bulkUpsertTracks
} from './services/database.js';
import { getLeagueLeaderboard, validateTrackInput } from './services/league.js';
import { getAnnualRankingFromDatabase, getWeeklyRankingPreview, storeCurrentWeekScores } from './services/rankings.js';
import { replaceWeeklyTracks } from './services/weekAdmin.js';
import { checkLeaderboardImprovements, getTelegramStatus, handleTelegramUpdate, registerTelegramWebhook, sendTopMessageToChats } from './services/telegram.js';
import { validatePilotRegistrationInput, validatePilotStatusInput } from './services/pilots.js';
import { asyncHandler } from './utils/http.js';
import { SPAIN_TIMEZONE, formatSpainDateTime, toSpainOffsetIso } from './utils/date.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicRoot = path.join(__dirname, 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      service: 'velocidrone-league-app',
      now: toSpainOffsetIso(),
      now_spain: formatSpainDateTime(),
      timezone: SPAIN_TIMEZONE,
      ...getConfigSummary()
    });
  });

  app.get('/api/pilots/active', asyncHandler(async (req, res) => {
    const pilots = await listActivePilots();
    res.json({ pilots });
  }));

  app.post('/api/pilots/register', asyncHandler(async (req, res) => {
    const pilot = validatePilotRegistrationInput(req.body || {});
    const result = await registerPendingPilot(pilot);

    res.status(result.created ? 201 : 200).json({
      ok: true,
      message: result.created
        ? 'Solicitud enviada. El piloto queda pendiente de activación en el panel admin.'
        : 'La solicitud ya existía. Hemos actualizado los datos y sigue pendiente de activación.',
      ...result
    });
  }));

  app.get('/api/admin/pilots', requireAdmin, asyncHandler(async (req, res) => {
    const pilots = await listPilots({ activeOnly: false });
    res.json({ pilots });
  }));

  app.patch('/api/admin/pilots/:id/status', requireAdmin, asyncHandler(async (req, res) => {
    const { active } = validatePilotStatusInput(req.body || {});
    const pilot = await updatePilotActiveStatus({ id: req.params.id, active });
    res.json({
      ok: true,
      message: active ? 'Piloto activado correctamente.' : 'Piloto desactivado correctamente.',
      pilot
    });
  }));

  app.get('/api/tracks', asyncHandler(async (req, res) => {
    const tracks = await listTracks({ activeOnly: false });
    res.json({ tracks });
  }));

  app.get('/api/tracks/active', asyncHandler(async (req, res) => {
    const tracks = await listTracks({ activeOnly: true });
    res.json({ tracks });
  }));

  app.post('/api/admin/tracks/upsert', requireAdmin, asyncHandler(async (req, res) => {
    const track = validateTrackInput(req.body || {});
    const saved = await bulkUpsertTracks([track]);
    res.json({ ok: true, track: saved[0] });
  }));

  app.post('/api/admin/tracks/bulk-upsert', requireAdmin, asyncHandler(async (req, res) => {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) {
      return res.status(400).json({ error: 'Debes enviar al menos una entrada en entries.' });
    }

    const sanitizedEntries = entries.map((entry) => validateTrackInput(entry));
    const results = await bulkUpsertTracks(sanitizedEntries);
    res.json({ ok: true, tracks: results });
  }));

  app.post('/api/admin/week/change-tracks', requireAdmin, asyncHandler(async (req, res) => {
    const result = await replaceWeeklyTracks({
      seasonYear: req.body?.season_year,
      weekKey: req.body?.week_key,
      entries: req.body?.entries,
      commitWeek: req.body?.commit_week !== false,
      clearMonitorState: req.body?.clear_monitor_state !== false
    });

    res.json(result);
  }));

  app.get('/api/rankings/weekly', asyncHandler(async (req, res) => {
    const weekly = await getWeeklyRankingPreview();
    res.json(weekly);
  }));

  app.get('/api/rankings/annual', asyncHandler(async (req, res) => {
    const annual = await getAnnualRankingFromDatabase({ seasonYear: req.query.season_year });
    res.json(annual);
  }));

  app.post('/api/admin/rankings/award-weekly', requireAdmin, asyncHandler(async (req, res) => {
    const result = await storeCurrentWeekScores({
      seasonYear: req.body?.season_year,
      weekKey: req.body?.week_key
    });
    res.json({ ok: true, ...result });
  }));

  app.get('/api/leaderboard', asyncHandler(async (req, res) => {
    const allowAll = String(req.query.filter || '').toLowerCase() === 'all' && isAdminRequest(req);
    const leaderboard = await getLeagueLeaderboard({
      query: req.query,
      bypassLeagueFilter: allowAll
    });

    res.json({
      track: leaderboard.track,
      meta: leaderboard.meta,
      results: leaderboard.results
    });
  }));

  app.get('/api/telegram/status', (req, res) => {
    res.json(getTelegramStatus());
  });

  app.post('/api/admin/telegram/register-webhook', requireAdmin, asyncHandler(async (req, res) => {
    const result = await registerTelegramWebhook();
    res.json({ ok: true, ...result });
  }));


  app.post('/api/admin/telegram/send-top', requireAdmin, asyncHandler(async (req, res) => {
    const chatIds = Array.isArray(req.body?.chat_ids) ? req.body.chat_ids : undefined;
    const result = await sendTopMessageToChats(chatIds);
    res.json({ ok: true, ...result });
  }));

  app.post('/api/admin/telegram/check-improvements', requireAdmin, asyncHandler(async (req, res) => {
    const chatIds = Array.isArray(req.body?.chat_ids) ? req.body.chat_ids : undefined;
    const notify = req.body?.notify !== false;
    const result = await checkLeaderboardImprovements({ chatIds, notify });
    res.json({ ok: true, ...result });
  }));

  app.post('/api/telegram/webhook/:secret', asyncHandler(async (req, res) => {
    if (!config.telegram.webhookSecret || req.params.secret !== config.telegram.webhookSecret) {
      return res.status(401).json({ error: 'Webhook secret inválido.' });
    }

    const result = await handleTelegramUpdate(req.body || {});
    res.json({ ok: true, result });
  }));

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicRoot, 'admin.html'));
  });

  app.get('/alta-piloto', (req, res) => {
    res.sendFile(path.join(publicRoot, 'pilot-signup.html'));
  });

  app.use(express.static(publicRoot));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Ruta API no encontrada.' });
  });

  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(publicRoot, 'index.html'));
  });

  app.use((error, req, res, next) => {
    console.error(error);
    const status = error.status || 500;
    res.status(status).json({
      error: error.message || 'Error interno del servidor.',
      details: error.details || null
    });
  });

  return app;
}
