import { config } from '../config.js';
import { listTracks, listLeaderboardMonitorState, upsertLeaderboardMonitorState } from './database.js';
import { getLeagueLeaderboard } from './league.js';
import { buildLeaderboardMessage, countryCodeToFlag } from '../utils/leaderboard.js';
import { createHttpError } from '../utils/http.js';
import { normalizeText, parseLapCount } from '../utils/normalize.js';
import { getAnnualRankingFromDatabase } from './rankings.js';
import { SPAIN_TIMEZONE, formatSpainDateTime, formatSpainDateTimeFromIso, toSpainOffsetIso } from '../utils/date.js';
import { buildTrackPodiumImage } from './podiumImage.js';

let topAutopostTimer = null;
let topAutopostState = {
  enabled: false,
  intervalMs: 0,
  running: false,
  targetChats: [],
  lastRunAt: null,
  lastRunOk: null,
  lastError: null,
  startedAt: null,
  nextRunAt: null
};

let improvementMonitorTimer = null;
let improvementMonitorState = {
  enabled: false,
  intervalMs: 0,
  running: false,
  targetChats: [],
  lastRunAt: null,
  lastRunOk: null,
  lastError: null,
  startedAt: null,
  lastCheckedTracks: 0,
  lastImprovements: 0,
  bootstrapped: false,
  nextRunAt: null
};

function telegramApiUrl(method) {
  return `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;
}

function isTelegramConfigured() {
  return Boolean(config.telegram.botToken && config.telegram.webhookSecret);
}

function getBroadcastChatIds() {
  return config.telegram.allowedChatIds.map(String).filter(Boolean);
}

function isAllowedChat(chatId) {
  const allowed = getBroadcastChatIds();
  if (!allowed.length) return true;
  return allowed.includes(String(chatId));
}

function cleanCommand(text) {
  const [command = '', ...args] = String(text || '').trim().split(/\s+/);
  return {
    command: command.replace(/@[^\s]+$/, '').toLowerCase(),
    args
  };
}

function rankEmoji(position) {
  if (position === 1) return '🥇';
  if (position === 2) return '🥈';
  if (position === 3) return '🥉';
  return '🪻';
}

function stripProtocol(url) {
  return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function normalizeThreadId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getTopThreadId() {
  return normalizeThreadId(config.telegram.topThreadId);
}

function getSupertopThreadId() {
  return normalizeThreadId(config.telegram.supertopThreadId);
}

function getTracksThreadId() {
  return normalizeThreadId(config.telegram.tracksThreadId);
}

function getThreadSummary() {
  return {
    top: getTopThreadId(),
    improvements: getTopThreadId(),
    supertop: getSupertopThreadId(),
    tracks: getTracksThreadId()
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTrackSection(track, results) {
  const trackName = escapeHtml(track.name || 'Track sin nombre');
  const lines = [`📍 <b>${trackName}</b>`, ''];

  if (!results.length) {
    lines.push('Sin tiempos registrados todavía.');
    return lines.join('\n');
  }

  const topRows = results.map((row) => {
    const pilotName = escapeHtml(row.playername || 'Sin nombre');
    const lapTime = escapeHtml(row.lap_time || 'sin tiempo');
    const flag = countryCodeToFlag(row.country);
    const countrySuffix = flag ? ` ${flag}` : '';
    return `${rankEmoji(row.position)} <b>${pilotName}</b>${countrySuffix} — ${lapTime}`;
  });
  return lines.concat(topRows).join('\n');
}

function buildPilotKey(row) {
  const userId = Number(row.user_id);
  if (Number.isFinite(userId) && userId > 0) {
    return `user:${userId}`;
  }
  return `name:${normalizeText(row.playername)}`;
}


function buildImprovementMessage({ trackLabel, track, pilotName, previousTime, newTime, happenedAt = new Date() }) {
  const trackLine = track?.name
    ? `${escapeHtml(track.name)}${track?.scenery_name ? ` (${escapeHtml(track.scenery_name)})` : ''}`
    : escapeHtml(trackLabel || 'Track');

  const lines = [
    '<b>🏁 Liga Semanal Velocidrone</b>',
    `<b>⏱️ Nueva mejora de tiempo en el ${escapeHtml(trackLabel)}</b>`,
    `📍 ${trackLine}`,
    `<b>👤 Piloto:</b> ${escapeHtml(pilotName)}`,
    `<b>🔻 Tiempo anterior:</b> ${escapeHtml(previousTime)}`,
    `<b>✅ Nuevo tiempo:</b> ${escapeHtml(newTime)}`,
    `📅 ${escapeHtml(formatSpainDateTime(happenedAt))}`
  ];

  return lines.join('\n');
}

function createMonitorRow(track, row) {
  return {
    track_uuid: track.id,
    track_name: track.name,
    track_reference: track.is_official ? String(track.track_id) : String(track.online_id),
    laps: Number(track.laps),
    pilot_user_id: Number.isFinite(Number(row.user_id)) ? Number(row.user_id) : null,
    pilot_name: row.playername || 'Sin nombre',
    pilot_key: buildPilotKey(row),
    best_lap_time: row.lap_time || null,
    best_lap_time_ms: Number(row.lap_time_ms),
    last_seen_at: toSpainOffsetIso()
  };
}

function calculateNextRunAt(intervalMs) {
  return intervalMs > 0 ? toSpainOffsetIso(new Date(Date.now() + intervalMs)) : null;
}

function addHumanTimes(state) {
  return {
    ...state,
    timezone: SPAIN_TIMEZONE,
    startedAtSpain: formatSpainDateTimeFromIso(state.startedAt),
    lastRunAtSpain: formatSpainDateTimeFromIso(state.lastRunAt),
    nextRunAtSpain: formatSpainDateTimeFromIso(state.nextRunAt)
  };
}

function buildExistingStateMap(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.track_uuid}::${row.pilot_key}`, row);
  }
  return map;
}

export async function buildTelegramTopMessage() {
  const tracks = await listTracks({ activeOnly: true });
  if (!tracks.length) {
    return 'No hay tracks activos en este momento.';
  }

  const sections = [];
  for (const track of tracks) {
    const leaderboard = await getLeagueLeaderboard({
      query: track.is_official
        ? { track_id: track.track_id, laps: track.laps }
        : { online_id: track.online_id, laps: track.laps }
    });

    sections.push(buildTrackSection(track, leaderboard.results || []));
  }

  const footer = config.publicBaseUrl
    ? `\n\n📊 Consulta los rankings completos en:\n➡️ ${stripProtocol(config.publicBaseUrl)}`
    : '';

  return sections.join('\n\n') + footer;
}

export function getTelegramStatus() {
  return {
    configured: isTelegramConfigured(),
    timezone: SPAIN_TIMEZONE,
    hasBotToken: Boolean(config.telegram.botToken),
    hasWebhookSecret: Boolean(config.telegram.webhookSecret),
    allowedChats: getBroadcastChatIds(),
    threads: getThreadSummary(),
    topAutopost: addHumanTimes(topAutopostState),
    improvementMonitor: addHumanTimes(improvementMonitorState)
  };
}

export async function callTelegram(method, payload) {
  if (!config.telegram.botToken) {
    throw createHttpError(503, 'TELEGRAM_BOT_TOKEN no está configurado.');
  }

  const response = await fetch(telegramApiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw createHttpError(502, 'Telegram API devolvió un error.', data);
  }

  return data;
}


export async function sendTelegramPhoto(chatId, photoBuffer, options = {}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([photoBuffer], { type: 'image/jpeg' }), options.filename || 'podium.jpg');

  if (options.caption) {
    form.append('caption', options.caption);
  }
  if (options.parseMode) {
    form.append('parse_mode', options.parseMode);
  }

  const threadId = normalizeThreadId(options.messageThreadId);
  if (threadId) {
    form.append('message_thread_id', String(threadId));
  }

  const response = await fetch(telegramApiUrl('sendPhoto'), {
    method: 'POST',
    body: form
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw createHttpError(502, 'Telegram API devolvió un error al enviar la imagen.', data);
  }

  return data;
}

function splitTelegramMessage(text, maxLength = 3500) {
  const normalized = String(text ?? '');
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks = [];
  let current = '';

  for (const line of normalized.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (line.length <= maxLength) {
      current = line;
      continue;
    }

    for (let start = 0; start < line.length; start += maxLength) {
      chunks.push(line.slice(start, start + maxLength));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.filter(Boolean);
}

export async function sendTelegramMessage(chatId, text, options = {}) {
  const chunks = splitTelegramMessage(text);
  const results = [];

  for (const chunk of chunks) {
    const payload = {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true
    };

    if (options.parseMode) {
      payload.parse_mode = options.parseMode;
    }

    if (options.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }

    const threadId = normalizeThreadId(options.messageThreadId);
    if (threadId) {
      payload.message_thread_id = threadId;
    }

    results.push(await callTelegram('sendMessage', payload));
  }

  return results;
}


export async function notifyAdminPilotRegistration(result = {}) {
  const adminChatId = String(config.telegram.adminChatId || '').trim();
  const pilot = result?.pilot || {};

  if (!adminChatId) {
    console.warn('Aviso de registro no enviado: TELEGRAM_ADMIN_CHAT_ID no está configurado.');
    return { sent: false, reason: 'admin_chat_not_configured' };
  }

  if (!config.telegram.botToken) {
    console.warn('Aviso de registro no enviado: TELEGRAM_BOT_TOKEN no está configurado.');
    return { sent: false, reason: 'bot_token_not_configured' };
  }

  const requestType = result?.created
    ? 'Nueva solicitud'
    : 'Solicitud actualizada';
  const registeredAt = formatSpainDateTimeFromIso(pilot.created_at) || formatSpainDateTime();
  const adminPanelUrl = config.publicBaseUrl ? `${config.publicBaseUrl}/admin.html` : '';

  const lines = [
    '🆕 <b>Solicitud de registro</b>',
    '',
    `👤 <b>Piloto:</b> ${escapeHtml(pilot.name || 'Sin nombre')}`,
    `📝 <b>Tipo:</b> ${escapeHtml(requestType)}`,
    '⏳ <b>Estado:</b> Pendiente de aprobación',
    `📅 <b>Fecha:</b> ${escapeHtml(registeredAt)}`
  ];

  if (adminPanelUrl) {
    lines.push('', `🔗 <a href="${escapeHtml(adminPanelUrl)}">Abrir panel de administración</a>`);
  }

  try {
    console.log('[AVISO_ADMIN_TELEGRAM] Intentando enviar aviso.', {
      adminChatId,
      pilot: pilot.name || 'Sin nombre',
      requestType
    });

    await sendTelegramMessage(adminChatId, lines.join('\n'), { parseMode: 'HTML' });

    console.log('[AVISO_ADMIN_TELEGRAM] Aviso enviado correctamente.', {
      adminChatId,
      pilot: pilot.name || 'Sin nombre'
    });

    return { sent: true, adminChatId };
  } catch (error) {
    // Nunca se propaga el error para no bloquear el alta del piloto.
    console.error('No se pudo enviar el aviso de nuevo registro a Telegram:', error?.message || error);
    return { sent: false, reason: 'telegram_error', error: error?.message || String(error) };
  }
}

export async function registerTelegramWebhook() {
  if (!isTelegramConfigured()) {
    throw createHttpError(503, 'Telegram no está totalmente configurado. Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET.');
  }

  if (!config.publicBaseUrl) {
    throw createHttpError(503, 'PUBLIC_BASE_URL es obligatoria para registrar el webhook de Telegram.');
  }

  const webhookUrl = `${config.publicBaseUrl}/api/telegram/webhook/${config.telegram.webhookSecret}`;
  const result = await callTelegram('setWebhook', { url: webhookUrl });
  return {
    webhookUrl,
    telegram: result
  };
}

function getRaceModeLabel(track) {
  const laps = Number(track?.laps);
  if (laps === 1) return 'Single Class';
  if (laps === 3) return 'Three Lap Race';
  return `${escapeHtml(laps || 'N/D')} Laps`;
}

function buildTracksMessage(tracks) {
  if (!tracks.length) {
    return '<b>No hay tracks activos en este momento.</b>';
  }

  const orderedTracks = [...tracks].sort((left, right) => Number(left.laps) - Number(right.laps) || String(left.name).localeCompare(String(right.name)));
  return [
    '<b>🏁 TRACKS SEMANALES</b>',
    '',
    ...orderedTracks.flatMap((track, index) => {
      const lines = [
        `🏁 <b>Track ${index + 1}</b>`,
        `🎮 <b>Race Mode:</b> ${getRaceModeLabel(track)}`,
        `📍 <b>${escapeHtml(track.name || 'No configurado')}</b>`,
        `🌍 <b>Escenario:</b> ${escapeHtml(track.scenery_name || 'No configurado')}`
      ];

      if (index < orderedTracks.length - 1) {
        lines.push('', '━━━━━━━━━━━━━━━━', '');
      }
      return lines;
    })
  ].join('\n').trim();
}


async function buildCurrentCountryLookup() {
  const tracks = await listTracks({ activeOnly: true });
  const byUserId = new Map();
  const byName = new Map();

  for (const track of tracks) {
    const leaderboard = await getLeagueLeaderboard({
      query: track.is_official
        ? { track_id: track.track_id, laps: track.laps }
        : { online_id: track.online_id, laps: track.laps }
    });

    for (const row of leaderboard.results || []) {
      const country = String(row.country || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) continue;

      const userId = Number(row.user_id);
      if (Number.isFinite(userId) && userId > 0) {
        byUserId.set(userId, country);
      }

      const nameKey = normalizeText(row.playername);
      if (nameKey) {
        byName.set(nameKey, country);
      }
    }
  }

  return { byUserId, byName };
}

function enrichAnnualRankingCountries(annual, lookup) {
  return {
    ...annual,
    results: (annual?.results || []).map((row) => {
      const userId = Number(row.pilot_user_id);
      const country = (
        (Number.isFinite(userId) && userId > 0 ? lookup.byUserId.get(userId) : '')
        || lookup.byName.get(normalizeText(row.pilot_name))
        || row.country
        || ''
      );

      return { ...row, country };
    })
  };
}

function buildAnnualRankingMessage(annual) {
  const results = annual?.results || [];
  const seasonYear = annual?.season_year || new Date().getFullYear();

  if (!results.length) {
    return [
      `<b>🏆 RANKING ANUAL ${escapeHtml(seasonYear)}</b>`,
      '',
      'Todavía no hay puntos acumulados en la base de datos.'
    ].join('\n');
  }

  const topRows = results.map((row) => {
    const medal = rankEmoji(row.position);
    const name = escapeHtml(row.pilot_name || 'Sin nombre');
    const points = Number(row.total_points) || 0;
    const flag = countryCodeToFlag(row.country);
    const countrySuffix = flag ? ` ${flag}` : '';
    return `${medal} ${row.position}. <b>${name}</b>${countrySuffix} — ${points} pt${points === 1 ? '' : 's'}`;
  });

  return [
    `<b>🏆 RANKING ANUAL ${escapeHtml(seasonYear)}</b>`,
    '',
    ...topRows
  ].join('\n');
}

export async function buildTelegramSupertopMessage({ seasonYear } = {}) {
  const annual = await getAnnualRankingFromDatabase({ seasonYear });

  try {
    const countryLookup = await buildCurrentCountryLookup();
    return buildAnnualRankingMessage(enrichAnnualRankingCountries(annual, countryLookup));
  } catch (error) {
    console.warn('No se pudieron añadir las banderas al ranking anual:', error.message);
    return buildAnnualRankingMessage(annual);
  }
}

export async function sendTracksMessageToChats(chatIds = getBroadcastChatIds()) {
  const targets = Array.from(new Set((chatIds || []).map(String).filter(Boolean)));
  if (!targets.length) {
    throw createHttpError(400, 'No hay chats configurados para enviar /tracks. Revisa TELEGRAM_ALLOWED_CHAT_IDS.');
  }

  const tracks = await listTracks({ activeOnly: true });
  const text = buildTracksMessage(tracks);
  const deliveries = [];
  const messageThreadId = getTracksThreadId();

  for (const chatId of targets) {
    await sendTelegramMessage(chatId, text, { messageThreadId, parseMode: 'HTML' });
    deliveries.push({ chatId, messageThreadId, ok: true, kind: 'text' });
  }

  return {
    chatCount: targets.length,
    deliveries,
    text
  };
}

export async function sendSupertopMessageToChats(chatIds = getBroadcastChatIds(), { seasonYear } = {}) {
  const targets = Array.from(new Set((chatIds || []).map(String).filter(Boolean)));
  if (!targets.length) {
    throw createHttpError(400, 'No hay chats configurados para enviar /supertop. Revisa TELEGRAM_ALLOWED_CHAT_IDS.');
  }

  const text = await buildTelegramSupertopMessage({ seasonYear });
  const deliveries = [];
  const messageThreadId = getSupertopThreadId();

  for (const chatId of targets) {
    await sendTelegramMessage(chatId, text, { messageThreadId, parseMode: 'HTML' });
    deliveries.push({ chatId, messageThreadId, ok: true, kind: 'text' });
  }

  return {
    chatCount: targets.length,
    deliveries,
    text
  };
}


async function buildWeeklyPodiumPayloads() {
  const tracks = await listTracks({ activeOnly: true });
  if (!tracks.length) {
    return [];
  }

  const orderedTracks = [...tracks].sort((left, right) => Number(left.laps) - Number(right.laps) || String(left.name).localeCompare(String(right.name)));
  const payloads = [];

  for (const [index, track] of orderedTracks.entries()) {
    const leaderboard = await getLeagueLeaderboard({
      query: track.is_official
        ? { track_id: track.track_id, laps: track.laps }
        : { online_id: track.online_id, laps: track.laps }
    });

    const results = leaderboard.results || [];
    const firstPilot = results[0]?.playername || 'Sin piloto';
    const secondPilot = results[1]?.playername || 'Sin piloto';
    const thirdPilot = results[2]?.playername || 'Sin piloto';
    const trackLabel = `Track ${index + 1}`;
    const trackTitle = track.name || leaderboard.track?.name || trackLabel || 'Track semanal';

    const photoBuffer = await buildTrackPodiumImage({
      trackName: trackTitle,
      firstPilot,
      secondPilot,
      thirdPilot
    });

    payloads.push({
      trackLabel,
      trackName: track.name || leaderboard.track?.name || 'Track semanal',
      firstPilot,
      secondPilot,
      thirdPilot,
      photoBuffer,
      filename: `${normalizeText(trackTitle) || `track-${index + 1}`}-podium.jpg`
    });
  }

  return payloads;
}

export async function sendTopMessageToChats(chatIds = getBroadcastChatIds()) {
  const targets = Array.from(new Set((chatIds || []).map(String).filter(Boolean)));
  if (!targets.length) {
    throw createHttpError(400, 'No hay chats configurados para enviar /top. Revisa TELEGRAM_ALLOWED_CHAT_IDS.');
  }

  const text = await buildTelegramTopMessage();
  const deliveries = [];

  const messageThreadId = getTopThreadId();
  for (const chatId of targets) {
    await sendTelegramMessage(chatId, text, { messageThreadId, parseMode: 'HTML' });
    deliveries.push({ chatId, messageThreadId, ok: true, kind: 'text' });
  }

  return {
    chatCount: targets.length,
    deliveries,
    text
  };
}

export async function sendWeeklyTopAndPodiumsToChats(chatIds = getBroadcastChatIds()) {
  const targets = Array.from(new Set((chatIds || []).map(String).filter(Boolean)));
  if (!targets.length) {
    throw createHttpError(400, 'No hay chats configurados para enviar el resumen semanal. Revisa TELEGRAM_ALLOWED_CHAT_IDS.');
  }

  const topResult = await sendTopMessageToChats(targets);
  const podiums = await buildWeeklyPodiumPayloads();
  const deliveries = [...topResult.deliveries];
  const messageThreadId = getTopThreadId();

  for (const chatId of targets) {
    for (const podium of podiums) {
      await sendTelegramPhoto(chatId, podium.photoBuffer, {
        messageThreadId,
        filename: podium.filename
      });
      deliveries.push({ chatId, messageThreadId, ok: true, kind: 'photo', trackLabel: podium.trackLabel });
    }
  }

  return {
    chatCount: targets.length,
    text: topResult.text,
    podiumCount: podiums.length,
    podiums: podiums.map(({ trackLabel, trackName, firstPilot, secondPilot, thirdPilot }) => ({ trackLabel, trackName, firstPilot, secondPilot, thirdPilot })),
    deliveries
  };
}

async function sendMessagesToChats(messages = [], chatIds = getBroadcastChatIds(), options = {}) {
  const targets = Array.from(new Set((chatIds || []).map(String).filter(Boolean)));
  if (!targets.length) {
    return {
      chatCount: 0,
      messageCount: messages.length,
      deliveries: [],
      skipped: true,
      reason: 'No hay chats configurados para notificar mejoras.'
    };
  }

  const deliveries = [];
  const messageThreadId = normalizeThreadId(options.messageThreadId);
  for (const chatId of targets) {
    for (const text of messages) {
      await sendTelegramMessage(chatId, text, { messageThreadId, parseMode: 'HTML' });
      deliveries.push({ chatId, messageThreadId, ok: true });
    }
  }

  return {
    chatCount: targets.length,
    messageCount: messages.length,
    deliveries
  };
}

async function runTopAutopostCycle() {
  if (topAutopostState.running) return;
  topAutopostState.running = true;
  topAutopostState.lastRunAt = toSpainOffsetIso();
  topAutopostState.nextRunAt = calculateNextRunAt(topAutopostState.intervalMs);

  try {
    const result = await sendTopMessageToChats();
    topAutopostState.lastRunOk = true;
    topAutopostState.lastError = null;
    return result;
  } catch (error) {
    topAutopostState.lastRunOk = false;
    topAutopostState.lastError = error.message || 'Error desconocido enviando /top automático.';
    console.error('❌ Error en el monitor automático de Telegram /top:', error);
    return null;
  } finally {
    topAutopostState.running = false;
  }
}

export function startTelegramTopAutopostMonitor() {
  if (topAutopostTimer) {
    return addHumanTimes({ ...topAutopostState, alreadyStarted: true });
  }

  const targetChats = getBroadcastChatIds();
  const intervalMinutes = Math.max(1, Number(config.telegram.topAutopostIntervalMinutes) || 360);
  const intervalMs = intervalMinutes * 60 * 1000;
  const enabled = Boolean(config.telegram.topAutopostEnabled && config.telegram.botToken && targetChats.length);

  topAutopostState = {
    enabled,
    intervalMs,
    running: false,
    targetChats,
    lastRunAt: null,
    lastRunOk: null,
    lastError: enabled ? null : 'Monitor desactivado o sin chats configurados.',
    startedAt: toSpainOffsetIso(),
    nextRunAt: enabled ? calculateNextRunAt(intervalMs) : null
  };

  if (!enabled) {
    return addHumanTimes(topAutopostState);
  }

  topAutopostTimer = setInterval(() => {
    runTopAutopostCycle().catch((error) => {
      console.error('❌ Error inesperado en setInterval del monitor /top:', error);
    });
  }, intervalMs);

  if (typeof topAutopostTimer.unref === 'function') {
    topAutopostTimer.unref();
  }

  if (config.telegram.topAutopostOnBoot) {
    runTopAutopostCycle().catch((error) => {
      console.error('❌ Error en el primer envío automático /top:', error);
    });
  }

  return addHumanTimes(topAutopostState);
}

export async function checkLeaderboardImprovements({ chatIds = getBroadcastChatIds(), notify = true } = {}) {
  const tracks = await listTracks({ activeOnly: true });
  if (!tracks.length) {
    return {
      checked_tracks: 0,
      improvements: [],
      notifications: null,
      bootstrapped: false,
      checked_at: toSpainOffsetIso(),
      checked_at_spain: formatSpainDateTime(),
      message: 'No hay tracks activos para revisar mejoras.'
    };
  }

  const existingRows = await listLeaderboardMonitorState({ trackUuids: tracks.map((track) => track.id) });
  const existingState = buildExistingStateMap(existingRows);
  const upserts = [];
  const improvements = [];

  for (const [trackIndex, track] of tracks.entries()) {
    const leaderboard = await getLeagueLeaderboard({
      query: track.is_official
        ? { track_id: track.track_id, laps: track.laps }
        : { online_id: track.online_id, laps: track.laps }
    });

    for (const row of leaderboard.results || []) {
      if (!Number.isFinite(Number(row.lap_time_ms)) || Number(row.lap_time_ms) <= 0) continue;

      const monitorRow = createMonitorRow(track, row);
      const stateKey = `${track.id}::${monitorRow.pilot_key}`;
      const previous = existingState.get(stateKey);

      if (!previous) {
        upserts.push(monitorRow);
        existingState.set(stateKey, monitorRow);
        continue;
      }

      if (Number(monitorRow.best_lap_time_ms) < Number(previous.best_lap_time_ms)) {
        upserts.push(monitorRow);
        existingState.set(stateKey, { ...previous, ...monitorRow });
        improvements.push({
          track_uuid: track.id,
          track_label: `Track ${trackIndex + 1}`,
          track_name: track.name,
          laps: Number(track.laps),
          pilot_name: row.playername || previous.pilot_name || 'Sin nombre',
          pilot_key: monitorRow.pilot_key,
          previous_time: previous.best_lap_time || `${previous.best_lap_time_ms} ms`,
          previous_time_ms: Number(previous.best_lap_time_ms),
          new_time: row.lap_time || `${monitorRow.best_lap_time_ms} ms`,
          new_time_ms: Number(monitorRow.best_lap_time_ms),
          message: buildImprovementMessage({
            trackLabel: `Track ${trackIndex + 1}`,
            track,
            pilotName: row.playername || previous.pilot_name || 'Sin nombre',
            previousTime: previous.best_lap_time || `${previous.best_lap_time_ms} ms`,
            newTime: row.lap_time || `${monitorRow.best_lap_time_ms} ms`
          })
        });
      }
    }
  }

  if (upserts.length) {
    await upsertLeaderboardMonitorState(upserts);
  }

  let notifications = null;
  if (notify && improvements.length) {
    notifications = await sendMessagesToChats(improvements.map((item) => item.message), chatIds, { messageThreadId: getTopThreadId() });
  }

  return {
    checked_tracks: tracks.length,
    improvements,
    notifications,
    bootstrapped: existingRows.length === 0,
    checked_at: toSpainOffsetIso(),
    checked_at_spain: formatSpainDateTime(),
    message: improvements.length
      ? `Se han detectado ${improvements.length} mejora(s) de tiempo.`
      : 'No se han detectado mejoras de tiempo en esta comprobación.'
  };
}

async function runImprovementMonitorCycle({ notify = true } = {}) {
  if (improvementMonitorState.running) return null;
  improvementMonitorState.running = true;
  improvementMonitorState.lastRunAt = toSpainOffsetIso();
  improvementMonitorState.nextRunAt = calculateNextRunAt(improvementMonitorState.intervalMs);

  try {
    const result = await checkLeaderboardImprovements({ notify });
    improvementMonitorState.lastRunOk = true;
    improvementMonitorState.lastError = null;
    improvementMonitorState.lastCheckedTracks = result.checked_tracks || 0;
    improvementMonitorState.lastImprovements = result.improvements?.length || 0;
    improvementMonitorState.bootstrapped = !result.bootstrapped ? improvementMonitorState.bootstrapped : true;
    return result;
  } catch (error) {
    improvementMonitorState.lastRunOk = false;
    improvementMonitorState.lastError = error.message || 'Error desconocido revisando mejoras de tiempos.';
    console.error('❌ Error en el monitor de mejoras de Telegram:', error);
    return null;
  } finally {
    improvementMonitorState.running = false;
  }
}

async function runImprovementMonitorBootSync() {
  return runImprovementMonitorCycle({ notify: config.telegram.improvementMonitorOnBoot });
}

export function startTelegramImprovementMonitor() {
  if (improvementMonitorTimer) {
    return addHumanTimes({ ...improvementMonitorState, alreadyStarted: true });
  }

  const targetChats = getBroadcastChatIds();
  const intervalMinutes = Math.max(1, Number(config.telegram.improvementIntervalMinutes) || 15);
  const intervalMs = intervalMinutes * 60 * 1000;
  const enabled = Boolean(config.telegram.improvementMonitorEnabled && config.telegram.botToken);

  improvementMonitorState = {
    enabled,
    intervalMs,
    running: false,
    targetChats,
    lastRunAt: null,
    lastRunOk: null,
    lastError: enabled ? (targetChats.length ? null : 'Monitor activo sin chats de notificación configurados. Seguirá guardando estado en base de datos.') : 'Monitor desactivado o sin TELEGRAM_BOT_TOKEN.',
    startedAt: toSpainOffsetIso(),
    nextRunAt: enabled ? calculateNextRunAt(intervalMs) : null,
    lastCheckedTracks: 0,
    lastImprovements: 0,
    bootstrapped: false
  };

  if (!enabled) {
    return addHumanTimes(improvementMonitorState);
  }

  improvementMonitorTimer = setInterval(() => {
    runImprovementMonitorCycle().catch((error) => {
      console.error('❌ Error inesperado en setInterval del monitor de mejoras:', error);
    });
  }, intervalMs);

  if (typeof improvementMonitorTimer.unref === 'function') {
    improvementMonitorTimer.unref();
  }

  setTimeout(() => {
    runImprovementMonitorBootSync().catch((error) => {
      console.error('❌ Error en la sincronización inicial automática de mejoras:', error);
    });
  }, 20 * 1000);

  return addHumanTimes(improvementMonitorState);
}


function buildHelpLanguageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🇪🇸 Español', callback_data: 'help:language:es' },
        { text: '🇬🇧 English', callback_data: 'help:language:en' }
      ]
    ]
  };
}

function buildHelpMenu(language = 'es') {
  const isEnglish = language === 'en';
  return {
    inline_keyboard: [
      [
        { text: isEnglish ? '🏁 Weekly tracks' : '🏁 Tracks semanales', callback_data: `help:tracks:${language}` },
        { text: isEnglish ? '📊 Weekly results' : '📊 Resultados semanales', callback_data: `help:top:${language}` }
      ],
      [
        { text: isEnglish ? '🏆 Annual ranking' : '🏆 Ranking anual', callback_data: `help:supertop:${language}` }
      ],
      [
        { text: isEnglish ? '🎮 Track leaderboard' : '🎮 Clasificación por modalidad', callback_data: `help:leaderboard:${language}` }
      ],
      [
        { text: isEnglish ? '📖 How it works' : '📖 Cómo funciona', callback_data: `help:how:${language}` },
        { text: isEnglish ? '🏅 Scoring system' : '🏅 Puntuación', callback_data: `help:scoring:${language}` }
      ],
      [
        { text: isEnglish ? '🌐 Change language' : '🌐 Cambiar idioma', callback_data: 'help:language' }
      ]
    ]
  };
}

function buildHelpBackKeyboard(language = 'es') {
  return {
    inline_keyboard: [
      [
        { text: language === 'en' ? '⬅️ Back to menu' : '⬅️ Volver al menú', callback_data: `help:language:${language}` }
      ],
      [
        { text: language === 'en' ? '🌐 Change language' : '🌐 Cambiar idioma', callback_data: 'help:language' }
      ]
    ]
  };
}

function buildLeaderboardKeyboard(language = 'es') {
  const isEnglish = language === 'en';
  return {
    inline_keyboard: [
      [
        { text: isEnglish ? '🏁 Single Class (1 lap)' : '🏁 Single Class (1 vuelta)', callback_data: `help:leaderboard1:${language}` }
      ],
      [
        { text: isEnglish ? '🏁 Three Lap Race (3 laps)' : '🏁 Three Lap Race (3 vueltas)', callback_data: `help:leaderboard3:${language}` }
      ],
      [
        { text: isEnglish ? '⬅️ Back to menu' : '⬅️ Volver al menú', callback_data: `help:language:${language}` }
      ]
    ]
  };
}

async function answerTelegramCallback(callbackQueryId, text = '') {
  if (!callbackQueryId) return null;
  return callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {})
  });
}

async function editTelegramMessage(chatId, messageId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true
  };

  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }
  if (options.replyMarkup) {
    payload.reply_markup = options.replyMarkup;
  }

  return callTelegram('editMessageText', payload);
}

async function handleHelpCallback(callbackQuery) {
  const data = String(callbackQuery?.data || '');
  const message = callbackQuery?.message;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;
  const currentThreadId = message?.message_thread_id;

  if (!data.startsWith('help:') || !chatId || !messageId) {
    return { handled: false, reason: 'Callback de ayuda no procesable.' };
  }

  if (!isAllowedChat(chatId)) {
    await answerTelegramCallback(callbackQuery.id, 'Chat no autorizado.');
    return { handled: false, reason: 'Chat no autorizado.' };
  }

  if (data === 'help:language') {
    await answerTelegramCallback(callbackQuery.id);
    await editTelegramMessage(
      chatId,
      messageId,
      '🌐 Selecciona tu idioma\nChoose your language:',
      { replyMarkup: buildHelpLanguageKeyboard() }
    );
    return { handled: true, callback: data };
  }

  const [, section, languageValue] = data.split(':');
  const language = languageValue === 'en' ? 'en' : 'es';
  const isEnglish = language === 'en';

  if (section === 'language') {
    await answerTelegramCallback(callbackQuery.id);
    await editTelegramMessage(
      chatId,
      messageId,
      isEnglish
        ? '<b>🚀 Velocidrone League</b>\n\nSelect an option:'
        : '<b>🚀 Liga Velocidrone</b>\n\nSelecciona una opción:',
      { parseMode: 'HTML', replyMarkup: buildHelpMenu(language) }
    );
    return { handled: true, callback: data, language };
  }

  if (section === 'tracks') {
    await answerTelegramCallback(callbackQuery.id, isEnglish ? 'Loading weekly tracks…' : 'Cargando tracks semanales…');
    const tracks = await listTracks({ activeOnly: true });
    const messageThreadId = getTracksThreadId();
    await sendTelegramMessage(chatId, buildTracksMessage(tracks), { messageThreadId, parseMode: 'HTML' });
    return { handled: true, callback: data, language, command: '/tracks', tracks: tracks.length, messageThreadId };
  }

  if (section === 'top') {
    await answerTelegramCallback(callbackQuery.id, isEnglish ? 'Loading weekly results…' : 'Cargando resultados semanales…');
    const text = await buildTelegramTopMessage();
    const messageThreadId = getTopThreadId();
    await sendTelegramMessage(chatId, text, { messageThreadId, parseMode: 'HTML' });
    return { handled: true, callback: data, language, command: '/top', messageThreadId };
  }

  if (section === 'supertop') {
    await answerTelegramCallback(callbackQuery.id, isEnglish ? 'Loading annual ranking…' : 'Cargando ranking anual…');
    const text = await buildTelegramSupertopMessage();
    const messageThreadId = getSupertopThreadId();
    await sendTelegramMessage(chatId, text, { messageThreadId, parseMode: 'HTML' });
    return { handled: true, callback: data, language, command: '/supertop', messageThreadId };
  }

  if (section === 'leaderboard') {
    await answerTelegramCallback(callbackQuery.id);
    await editTelegramMessage(
      chatId,
      messageId,
      isEnglish
        ? '<b>🎮 Track leaderboard</b>\n\nChoose the race mode:'
        : '<b>🎮 Clasificación por modalidad</b>\n\nElige el modo de carrera:',
      { parseMode: 'HTML', replyMarkup: buildLeaderboardKeyboard(language) }
    );
    return { handled: true, callback: data, language, section };
  }

  if (section === 'leaderboard1' || section === 'leaderboard3') {
    const laps = section === 'leaderboard1' ? 1 : 3;
    await answerTelegramCallback(callbackQuery.id, isEnglish ? 'Loading leaderboard…' : 'Cargando clasificación…');
    const leaderboard = await getLeagueLeaderboard({ query: { laps } });
    await sendTelegramMessage(
      chatId,
      buildLeaderboardMessage(leaderboard.track, leaderboard.results),
      { messageThreadId: currentThreadId }
    );
    return { handled: true, callback: data, language, command: '/leaderboard', laps };
  }

  const pages = {
    how: isEnglish
      ? '<b>📖 How the Velocidrone League Works</b>\n\n1️⃣ Register using your exact Velocidrone nickname at:\nhttps://ligavelocidrone.onrender.com\n\n2️⃣ Check the weekly tracks.\n\n3️⃣ Race throughout the week (Sunday to Sunday).\n\n4️⃣ The bot automatically records your best times.\n\n5️⃣ View the weekly results with /top.\n\n6️⃣ View the annual ranking with /supertop.\n\n✅ You do not need to submit your times manually.'
      : '<b>📖 Cómo funciona la Liga Velocidrone</b>\n\n1️⃣ Regístrate con tu nick exacto de Velocidrone en:\nhttps://ligavelocidrone.onrender.com\n\n2️⃣ Consulta los tracks semanales.\n\n3️⃣ Corre durante la semana (de domingo a domingo).\n\n4️⃣ El bot recoge automáticamente tus mejores tiempos.\n\n5️⃣ Consulta los resultados semanales con /top.\n\n6️⃣ Consulta el ranking anual con /supertop.\n\n✅ No necesitas enviar los tiempos manualmente.',
    scoring: isEnglish
      ? '<b>🏅 Scoring System</b>\n\nAt the end of each week, points are awarded separately for each track.\n\n🥇 1st → 10 points\n🥈 2nd → 9 points\n🥉 3rd → 8 points\n4th → 7 points\n5th → 6 points\n6th → 5 points\n7th → 4 points\n8th → 3 points\n9th → 2 points\n10th → 1 point\n\nFrom 11th place onwards, every pilot who completes the track receives 1 point.\n\nThe points earned on both tracks are added to the annual ranking.'
      : '<b>🏅 Sistema de puntuación</b>\n\nAl finalizar cada semana, cada track reparte puntos de forma independiente.\n\n🥇 1.º → 10 puntos\n🥈 2.º → 9 puntos\n🥉 3.º → 8 puntos\n4.º → 7 puntos\n5.º → 6 puntos\n6.º → 5 puntos\n7.º → 4 puntos\n8.º → 3 puntos\n9.º → 2 puntos\n10.º → 1 punto\n\nA partir del puesto 11.º, cada piloto que complete el track recibe 1 punto.\n\nLos puntos obtenidos en ambos tracks se suman al ranking anual.'
  };

  const text = pages[section];
  if (!text) {
    await answerTelegramCallback(callbackQuery.id);
    return { handled: false, reason: 'Opción de ayuda desconocida.' };
  }

  await answerTelegramCallback(callbackQuery.id);
  await editTelegramMessage(chatId, messageId, text, {
    parseMode: 'HTML',
    replyMarkup: buildHelpBackKeyboard(language)
  });
  return { handled: true, callback: data, language, section };
}

export async function handleTelegramUpdate(update) {
  const callbackQuery = update?.callback_query;
  if (callbackQuery) {
    return handleHelpCallback(callbackQuery);
  }

  const message = update?.message || update?.edited_message;
  if (!message?.text || !message.chat?.id) {
    return { handled: false, reason: 'No hay mensaje de texto procesable.' };
  }

  const { command, args } = cleanCommand(message.text);
  if (!command.startsWith('/')) {
    return { handled: false, reason: 'No es un comando.' };
  }

  if (!isAllowedChat(message.chat.id)) {
    return { handled: false, reason: 'Chat no autorizado.' };
  }



  if (command === '/ping') {
    await sendTelegramMessage(message.chat.id, '✅ Bot activo y escuchando.', { messageThreadId: message.message_thread_id });
    return { handled: true, command };
  }


  if (command === '/tracks') {
    const tracks = await listTracks({ activeOnly: true });
    const messageThreadId = getTracksThreadId();
    await sendTelegramMessage(message.chat.id, buildTracksMessage(tracks), { messageThreadId, parseMode: 'HTML' });
    return { handled: true, command, tracks: tracks.length, messageThreadId };
  }

  if (command === '/supertop') {
    const seasonYearArg = Number(args[0]);
    const seasonYear = Number.isInteger(seasonYearArg) && seasonYearArg > 0 ? seasonYearArg : undefined;
    const text = await buildTelegramSupertopMessage({ seasonYear });
    const messageThreadId = getSupertopThreadId();
    await sendTelegramMessage(message.chat.id, text, { messageThreadId, parseMode: 'HTML' });
    return { handled: true, command, seasonYear: seasonYear || null, messageThreadId };
  }

  if (command === '/top') {
    const text = await buildTelegramTopMessage();
    const messageThreadId = getTopThreadId();
    await sendTelegramMessage(message.chat.id, text, { messageThreadId, parseMode: 'HTML' });
    return { handled: true, command, messageThreadId };
  }

  if (command === '/leaderboard' || command === '/lb') {
    const requestedLaps = parseLapCount(args[0]) || null;
    const leaderboard = await getLeagueLeaderboard({
      query: requestedLaps ? { laps: requestedLaps } : {}
    });
    await sendTelegramMessage(message.chat.id, buildLeaderboardMessage(leaderboard.track, leaderboard.results), { messageThreadId: message.message_thread_id });
    return { handled: true, command, laps: requestedLaps || leaderboard.track.laps };
  }

  await sendTelegramMessage(
    message.chat.id,
    '🌐 Selecciona tu idioma\nChoose your language:',
    {
      messageThreadId: message.message_thread_id,
      replyMarkup: buildHelpLanguageKeyboard()
    }
  );
  return { handled: true, command: '/help' };
}

