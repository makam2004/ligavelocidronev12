import { config } from '../config.js';
import { getFirstActiveTrack, listActivePilots } from './database.js';
import { buildVelocidronePostData, mapLeaderboardRows, parseVelocidronePayload } from '../utils/leaderboard.js';
import { createHttpError } from '../utils/http.js';
import { normalizeText, parseLapCount, parsePositiveInteger } from '../utils/normalize.js';

const leaderboardCache = new Map();

function getCacheKey(track) {
  return `${track.is_official ? 'official' : 'unofficial'}:${track.track_id || track.online_id}:${track.laps}`;
}

function trackLabel(track) {
  return track.name || (track.is_official ? `Track oficial ${track.track_id}` : `Track no oficial ${track.online_id}`);
}

function normalizeTrack(row) {
  return {
    id: row.id || null,
    name: trackLabel(row),
    scenery_name: row.scenery_name || null,
    is_official: Boolean(row.is_official),
    track_id: row.track_id ? Number(row.track_id) : null,
    online_id: row.online_id || null,
    laps: Number(row.laps),
    active: Boolean(row.active),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function fetchVelocidroneTrackTimes(track) {
  if (!config.velocidrone.apiToken) {
    throw createHttpError(503, 'VELO_API_TOKEN no está configurado en el servidor.');
  }

  const cacheKey = getCacheKey(track);
  const now = Date.now();
  const cached = leaderboardCache.get(cacheKey);

  if (cached && now - cached.createdAt < config.velocidrone.cacheTtlMs) {
    return cached.rawRows;
  }

  const postData = buildVelocidronePostData(track);
  const response = await fetch(config.velocidrone.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.velocidrone.apiToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ post_data: postData })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw createHttpError(response.status || 502, 'Velocidrone devolvió un error.', {
      response: bodyText.slice(0, 500)
    });
  }

  const rawRows = parseVelocidronePayload(bodyText);
  leaderboardCache.set(cacheKey, {
    createdAt: now,
    rawRows
  });

  return rawRows;
}

export function validateTrackInput(input) {
  const isOfficial = input.is_official === true || input.is_official === 'true' || input.is_official === 1 || input.is_official === '1';
  const laps = parseLapCount(input.laps);

  if (!laps) {
    throw createHttpError(400, 'El campo laps debe ser 1 o 3.');
  }

  if (isOfficial) {
    const trackId = parsePositiveInteger(input.track_id);
    if (!trackId) {
      throw createHttpError(400, 'Para un track oficial necesitas un track_id válido.');
    }

    return {
      name: String(input.name || `Track oficial ${trackId}`).trim(),
      scenery_name: String(input.scenery_name || '').trim() || null,
      is_official: true,
      track_id: trackId,
      online_id: null,
      laps,
      active: input.active === undefined ? true : Boolean(input.active)
    };
  }

  const onlineId = String(input.online_id || '').trim();
  if (!onlineId) {
    throw createHttpError(400, 'Para un track no oficial necesitas un online_id válido.');
  }

  return {
    name: String(input.name || `Track no oficial ${onlineId}`).trim(),
    scenery_name: String(input.scenery_name || '').trim() || null,
    is_official: false,
    track_id: null,
    online_id: onlineId,
    laps,
    active: input.active === undefined ? true : Boolean(input.active)
  };
}

export async function resolveTrackFromQuery(query = {}) {
  const laps = parseLapCount(query.laps);
  const trackId = parsePositiveInteger(query.track_id);
  const onlineId = String(query.online_id || '').trim() || null;

  if (trackId && laps) {
    return normalizeTrack({
      name: `Track oficial ${trackId}`,
      scenery_name: null,
      is_official: true,
      track_id: trackId,
      online_id: null,
      laps,
      active: true
    });
  }

  if (onlineId && laps) {
    return normalizeTrack({
      name: `Track no oficial ${onlineId}`,
      scenery_name: null,
      is_official: false,
      track_id: null,
      online_id: onlineId,
      laps,
      active: true
    });
  }

  const activeTrack = await getFirstActiveTrack({ laps });
  if (!activeTrack) {
    throw createHttpError(404, 'No hay ningún track activo disponible.');
  }

  return normalizeTrack(activeTrack);
}

export async function getLeagueLeaderboard({ query = {}, bypassLeagueFilter = false } = {}) {
  const track = await resolveTrackFromQuery(query);
  const rawRows = await fetchVelocidroneTrackTimes(track);
  const mappedRows = mapLeaderboardRows(rawRows);

  let allowedUserIds = null;
  let allowedNames = null;

  if (!bypassLeagueFilter) {
    const pilots = await listActivePilots();
    allowedUserIds = new Set(
      pilots.map((pilot) => Number(pilot.user_id)).filter((value) => Number.isFinite(value) && value > 0)
    );
    allowedNames = new Set(
      pilots.map((pilot) => normalizeText(pilot.name)).filter(Boolean)
    );
  }

  const filteredRows = (allowedUserIds && allowedNames)
    ? mappedRows.filter((row) => {
        const idMatch = allowedUserIds.has(Number(row.user_id));
        const nameMatch = allowedNames.has(normalizeText(row.playername));
        return idMatch || nameMatch;
      })
    : mappedRows;

  const bestByPilot = new Map();
  for (const row of filteredRows) {
    const key = Number.isFinite(row.user_id) && row.user_id > 0
      ? `user:${row.user_id}`
      : `name:${normalizeText(row.playername)}`;
    const previous = bestByPilot.get(key);
    if (!previous || (Number.isFinite(row.lap_time_ms) && row.lap_time_ms < previous.lap_time_ms)) {
      bestByPilot.set(key, row);
    }
  }

  const results = Array.from(bestByPilot.values())
    .sort((left, right) => {
      const leftValue = Number.isFinite(left.lap_time_ms) ? left.lap_time_ms : Number.MAX_SAFE_INTEGER;
      const rightValue = Number.isFinite(right.lap_time_ms) ? right.lap_time_ms : Number.MAX_SAFE_INTEGER;
      return leftValue - rightValue;
    })
    .map((row, index) => ({
      position: index + 1,
      ...row
    }));

  return {
    track,
    meta: {
      raw_count: rawRows.length,
      filtered_count: filteredRows.length,
      returned_count: results.length,
      bypass_filter: bypassLeagueFilter,
      cache_ttl_ms: config.velocidrone.cacheTtlMs
    },
    results
  };
}
