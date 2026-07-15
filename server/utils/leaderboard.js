import { config } from '../config.js';
import { createHttpError } from './http.js';

export function raceModeFromLaps(laps) {
  return Number(laps) === 3 ? 6 : 3;
}

export function buildVelocidronePostData(track) {
  const base = {
    sim_version: config.velocidrone.simVersion,
    offset: 0,
    count: 200,
    race_mode: raceModeFromLaps(track.laps)
  };

  if (track.is_official) {
    return new URLSearchParams({
      ...base,
      track_id: String(track.track_id),
      protected_track_value: '1'
    }).toString();
  }

  return new URLSearchParams({
    ...base,
    track_id: String(track.online_id),
    protected_track_value: '0'
  }).toString();
}

export function parseTimeToMsFlexible(input) {
  if (!input) return null;
  const value = String(input).trim();
  const parts = value.split(':');
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let milliseconds = 0;

  try {
    if (parts.length === 3) {
      hours = Number(parts[0]);
      minutes = Number(parts[1]);
      const [ss, ms = '0'] = parts[2].split('.');
      seconds = Number(ss);
      milliseconds = Number(ms);
    } else if (parts.length === 2) {
      minutes = Number(parts[0]);
      const [ss, ms = '0'] = parts[1].split('.');
      seconds = Number(ss);
      milliseconds = Number(ms);
    } else {
      const [ss, ms = '0'] = value.split('.');
      seconds = Number(ss);
      milliseconds = Number(ms);
    }

    if ([hours, minutes, seconds].some((item) => Number.isNaN(item))) {
      return null;
    }

    return (((hours * 60 + minutes) * 60) + seconds) * 1000 + (Number.isNaN(milliseconds) ? 0 : milliseconds);
  } catch {
    return null;
  }
}

export function mapLeaderboardRows(rawRows) {
  return rawRows.map((row) => {
    const lapTime = row.lap_time ?? row.best_time ?? row.time ?? row.laptime ?? row.best_lap ?? row.bestlap ?? '';
    return {
      user_id: Number(row.user_id),
      playername: row.playername ?? row.name ?? row.username ?? '',
      country: row.country ?? row.flag ?? '',
      model_name: row.model_name ?? row.model ?? '',
      sim_version: row.sim_version ?? row.simversion ?? '',
      device_type: row.device_type ?? row.device ?? '',
      lap_time: lapTime,
      lap_time_ms: parseTimeToMsFlexible(lapTime)
    };
  });
}

export function parseVelocidronePayload(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.tracktimes) ? parsed.tracktimes : [];
  } catch (error) {
    throw createHttpError(502, 'La respuesta de Velocidrone no es JSON válido.', {
      rawResponse: text.slice(0, 500),
      cause: error.message
    });
  }
}

export function buildLeaderboardMessage(track, results) {
  const header = [
    '🏁 Leaderboard Liga Velocidrone',
    `${track.name} · ${track.laps} lap${track.laps === 3 ? 's' : ''}`,
    track.is_official ? `Track oficial: ${track.track_id}` : `Track no oficial: ${track.online_id}`,
    ''
  ];

  if (!results.length) {
    return header.concat('No hay resultados para los pilotos activos de la liga.').join('\n');
  }

  const lines = results.slice(0, 10).map((row) => {
    return `${row.position}. ${row.playername || 'Sin nombre'} — ${row.lap_time || 'sin tiempo'}`;
  });

  return header.concat(lines).join('\n');
}
