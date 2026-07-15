async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, data: { raw: text } };
  }
}

function currentWeekInfo(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  const seasonYear = utcDate.getUTCFullYear();
  return {
    seasonYear,
    weekKey: `${seasonYear}-W${String(weekNumber).padStart(2, '0')}`
  };
}

const els = {
  adminKey: document.getElementById('adminKey'),
  pilotsResult: document.getElementById('pilotsResult'),
  reloadPilotsList: document.getElementById('reloadPilotsList'),
  pilotsListBody: document.getElementById('pilotsListBody'),

  weekTrack1Name: document.getElementById('weekTrack1Name'),
  weekTrack1Scenery: document.getElementById('weekTrack1Scenery'),
  weekTrack1Laps: document.getElementById('weekTrack1Laps'),
  weekTrack1Official: document.getElementById('weekTrack1Official'),
  weekTrack1Id: document.getElementById('weekTrack1Id'),
  weekTrack1OnlineId: document.getElementById('weekTrack1OnlineId'),
  weekTrack1OfficialFields: document.getElementById('weekTrack1OfficialFields'),
  weekTrack1UnofficialFields: document.getElementById('weekTrack1UnofficialFields'),

  weekTrack2Name: document.getElementById('weekTrack2Name'),
  weekTrack2Scenery: document.getElementById('weekTrack2Scenery'),
  weekTrack2Laps: document.getElementById('weekTrack2Laps'),
  weekTrack2Official: document.getElementById('weekTrack2Official'),
  weekTrack2Id: document.getElementById('weekTrack2Id'),
  weekTrack2OnlineId: document.getElementById('weekTrack2OnlineId'),
  weekTrack2OfficialFields: document.getElementById('weekTrack2OfficialFields'),
  weekTrack2UnofficialFields: document.getElementById('weekTrack2UnofficialFields'),
  changeWeeklyTracks: document.getElementById('changeWeeklyTracks'),
  weeklyChangeResult: document.getElementById('weeklyChangeResult'),

  trackName: document.getElementById('trackName'),
  trackScenery: document.getElementById('trackScenery'),
  laps: document.getElementById('laps'),
  isOfficial: document.getElementById('isOfficial'),
  trackId: document.getElementById('trackId'),
  onlineId: document.getElementById('onlineId'),
  trackActive: document.getElementById('trackActive'),
  officialFields: document.getElementById('officialFields'),
  unofficialFields: document.getElementById('unofficialFields'),
  saveTrack: document.getElementById('saveTrack'),
  saveResult: document.getElementById('saveResult'),

  seasonYear: document.getElementById('seasonYear'),
  weekKey: document.getElementById('weekKey'),
  awardWeekly: document.getElementById('awardWeekly'),
  weeklyResult: document.getElementById('weeklyResult'),

  registerWebhook: document.getElementById('registerWebhook'),
  checkImprovements: document.getElementById('checkImprovements'),
  telegramResult: document.getElementById('telegramResult'),
  reloadStatus: document.getElementById('reloadStatus'),
  healthBox: document.getElementById('healthBox'),
  reloadTracksList: document.getElementById('reloadTracksList'),
  tracksListBody: document.getElementById('tracksListBody')
};

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-key': els.adminKey.value.trim()
  };
}

function toggleSingleTrackFields() {
  const official = els.isOfficial.checked;
  els.officialFields.classList.toggle('hidden', !official);
  els.unofficialFields.classList.toggle('hidden', official);
}

function toggleWeeklyTrackFields(prefix) {
  const official = els[`${prefix}Official`].checked;
  els[`${prefix}OfficialFields`].classList.toggle('hidden', !official);
  els[`${prefix}UnofficialFields`].classList.toggle('hidden', official);
}

function setResultBox(element, payload) {
  element.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

async function loadHealth() {
  const [health, telegram] = await Promise.all([
    fetchJson('/api/health'),
    fetchJson('/api/telegram/status')
  ]);

  setResultBox(els.healthBox, {
    health: health.data,
    telegram: telegram.data
  });
}

async function loadPilots() {
  const response = await fetchJson('/api/admin/pilots', {
    headers: adminHeaders()
  });

  if (!response.ok) {
    els.pilotsListBody.innerHTML = `<tr><td colspan="5" class="error">${response.data.error || 'No se pudieron cargar los pilotos.'}</td></tr>`;
    setResultBox(els.pilotsResult, response.data);
    return;
  }

  const pilots = response.data.pilots || [];
  if (!pilots.length) {
    els.pilotsListBody.innerHTML = '<tr><td colspan="5" class="muted">No hay pilotos guardados todavía.</td></tr>';
    return;
  }

  els.pilotsListBody.innerHTML = pilots.map((pilot) => `
    <tr>
      <td data-label="Estado">${pilot.active ? 'Activo' : 'Pendiente / Inactivo'}</td>
      <td data-label="ID registrado">${pilot.user_id || '-'}</td>
      <td data-label="Nombre">${pilot.name}</td>
      <td data-label="País">${pilot.country || '-'}</td>
      <td data-label="Acción">
        <button
          class="btn btn-secondary pilot-toggle"
          type="button"
          data-pilot-id="${pilot.id}"
          data-next-active="${pilot.active ? 'false' : 'true'}"
        >${pilot.active ? 'Desactivar' : 'Activar'}</button>
      </td>
    </tr>
  `).join('');
}

async function updatePilotStatus(pilotId, active) {
  const response = await fetchJson(`/api/admin/pilots/${pilotId}/status`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ active })
  });

  setResultBox(els.pilotsResult, response.data);
  if (response.ok) {
    await loadPilots();
  }
}

async function loadTracks() {
  const response = await fetchJson('/api/tracks');
  if (!response.ok) {
    els.tracksListBody.innerHTML = `<tr><td colspan="6" class="error">${response.data.error || 'No se pudieron cargar los tracks.'}</td></tr>`;
    return;
  }

  const tracks = response.data.tracks || [];
  if (!tracks.length) {
    els.tracksListBody.innerHTML = '<tr><td colspan="6" class="muted">No hay tracks guardados todavía.</td></tr>';
    return;
  }

  els.tracksListBody.innerHTML = tracks.map((track) => `
    <tr>
      <td data-label="Nombre">${track.name}</td>
      <td data-label="Tipo">${track.is_official ? 'Oficial' : 'No oficial'}</td>
      <td data-label="Escenario">${track.scenery_name || '-'}</td>
      <td data-label="Referencia">${track.is_official ? track.track_id : track.online_id}</td>
      <td data-label="Vueltas">${track.laps}</td>
      <td data-label="Activo">${track.active ? 'Sí' : 'No'}</td>
    </tr>
  `).join('');
}

function buildTrackPayload(prefix) {
  const isOfficial = els[`${prefix}Official`].checked;
  return {
    name: els[`${prefix}Name`].value.trim(),
    scenery_name: els[`${prefix}Scenery`].value.trim(),
    laps: Number(els[`${prefix}Laps`].value),
    is_official: isOfficial,
    active: true,
    track_id: isOfficial ? Number(els[`${prefix}Id`].value) : null,
    online_id: isOfficial ? null : els[`${prefix}OnlineId`].value.trim()
  };
}

async function changeWeeklyTracks() {
  const payload = {
    season_year: Number(els.seasonYear.value),
    week_key: els.weekKey.value.trim(),
    entries: [
      buildTrackPayload('weekTrack1'),
      buildTrackPayload('weekTrack2')
    ],
    commit_week: true,
    clear_monitor_state: true
  };

  const response = await fetchJson('/api/admin/week/change-tracks', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload)
  });

  setResultBox(els.weeklyChangeResult, response.data);
  if (response.ok) {
    await loadTracks();
    await loadHealth();
  }
}

async function saveTrack() {
  const payload = {
    name: els.trackName.value.trim(),
    scenery_name: els.trackScenery.value.trim(),
    laps: Number(els.laps.value),
    is_official: els.isOfficial.checked,
    active: els.trackActive ? els.trackActive.checked : true,
    track_id: els.isOfficial.checked ? Number(els.trackId.value) : null,
    online_id: els.isOfficial.checked ? null : els.onlineId.value.trim()
  };

  const response = await fetchJson('/api/admin/tracks/upsert', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload)
  });

  setResultBox(els.saveResult, response.data);
  if (response.ok) {
    await loadTracks();
  }
}

async function awardWeekly() {
  const payload = {
    season_year: Number(els.seasonYear.value),
    week_key: els.weekKey.value.trim()
  };

  const response = await fetchJson('/api/admin/rankings/award-weekly', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload)
  });

  setResultBox(els.weeklyResult, response.data);
}

async function registerWebhook() {
  const response = await fetchJson('/api/admin/telegram/register-webhook', {
    method: 'POST',
    headers: adminHeaders()
  });
  setResultBox(els.telegramResult, response.data);
}

async function checkImprovements() {
  const response = await fetchJson('/api/admin/telegram/check-improvements', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ notify: true })
  });
  setResultBox(els.telegramResult, response.data);
}

els.isOfficial.addEventListener('change', toggleSingleTrackFields);
els.weekTrack1Official.addEventListener('change', () => toggleWeeklyTrackFields('weekTrack1'));
els.weekTrack2Official.addEventListener('change', () => toggleWeeklyTrackFields('weekTrack2'));
els.changeWeeklyTracks.addEventListener('click', changeWeeklyTracks);
els.saveTrack.addEventListener('click', saveTrack);
els.awardWeekly.addEventListener('click', awardWeekly);
els.registerWebhook.addEventListener('click', registerWebhook);
els.checkImprovements.addEventListener('click', checkImprovements);
els.reloadStatus.addEventListener('click', loadHealth);
els.reloadTracksList.addEventListener('click', loadTracks);
els.reloadPilotsList.addEventListener('click', loadPilots);
els.pilotsListBody.addEventListener('click', async (event) => {
  const button = event.target.closest('.pilot-toggle');
  if (!button) return;

  const pilotId = button.dataset.pilotId;
  const nextActive = button.dataset.nextActive === 'true';
  await updatePilotStatus(pilotId, nextActive);
});

document.addEventListener('DOMContentLoaded', async () => {
  const weekInfo = currentWeekInfo();
  els.seasonYear.value = String(weekInfo.seasonYear);
  els.weekKey.value = weekInfo.weekKey;
  els.weekTrack1Laps.value = '1';
  els.weekTrack2Laps.value = '3';
  toggleSingleTrackFields();
  toggleWeeklyTrackFields('weekTrack1');
  toggleWeeklyTrackFields('weekTrack2');
  await loadHealth();
  await loadPilots();
  await loadTracks();
});
