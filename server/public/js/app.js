async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  try {
    return {
      ok: response.ok,
      status: response.status,
      data: JSON.parse(text)
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: { error: text || 'Respuesta no JSON.' }
    };
  }
}

const state = {
  tracks: [],
  selectedTrack: null,
  currentView: 'leaderboard',
  annualYear: new Date().getFullYear()
};

const elements = {
  tracks: document.getElementById('tracks'),
  leagueHeading: document.getElementById('leagueHeading'),
  trackTitle: document.getElementById('trackTitle'),
  trackSubtitle: document.getElementById('trackSubtitle'),
  tableBody: document.getElementById('tableBody'),
  status: document.getElementById('status'),
  reloadTracks: document.getElementById('reloadTracks'),
  viewTabs: document.getElementById('viewTabs'),
  leaderboardSection: document.getElementById('leaderboardSection'),
  weeklySection: document.getElementById('weeklySection'),
  annualSection: document.getElementById('annualSection'),
  weeklyStatus: document.getElementById('weeklyStatus'),
  weeklyNotice: document.getElementById('weeklyNotice'),
  weeklySummaryBody: document.getElementById('weeklySummaryBody'),
  weeklyTrackCards: document.getElementById('weeklyTrackCards'),
  annualStatus: document.getElementById('annualStatus'),
  annualBody: document.getElementById('annualBody'),
  annualYear: document.getElementById('annualYear'),
  reloadAnnual: document.getElementById('reloadAnnual')
};

function getSpainNowParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(new Date()).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = Number(part.value);
    return acc;
  }, {});

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day
  };
}

function getIsoWeekInSpain() {
  const { year, month, day } = getSpainNowParts();
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function renderLeagueHeading() {
  if (!elements.leagueHeading) return;
  elements.leagueHeading.textContent = `LIGA VELOCIDRONE · Semana ${String(getIsoWeekInSpain()).padStart(2, '0')}`;
}

function trackLabel(track) {
  return track.name || 'Track semanal';
}

function renderPageTitle() {
  if (state.currentView === 'leaderboard' && state.selectedTrack) {
    elements.trackTitle.textContent = trackLabel(state.selectedTrack);
    elements.trackSubtitle.textContent = `${state.selectedTrack.laps} lap${state.selectedTrack.laps === 3 ? 's' : ''}${state.selectedTrack.scenery_name ? ` · ${state.selectedTrack.scenery_name}` : ''}`;
    return;
  }

  if (state.currentView === 'weekly') {
    elements.trackTitle.textContent = 'Ranking semanal';
    elements.trackSubtitle.textContent = 'Puntos calculados con los tracks activos de la semana.';
    return;
  }

  elements.trackTitle.textContent = 'Ranking anual';
  elements.trackSubtitle.textContent = 'Total de puntos acumulados y guardados en Supabase.';
}

function renderViewTabs() {
  const views = [
    { key: 'leaderboard', label: 'Leaderboard' },
    { key: 'weekly', label: 'Ranking semanal' },
    { key: 'annual', label: 'Ranking anual' }
  ];

  elements.viewTabs.innerHTML = views.map((view) => `
    <button class="btn ${state.currentView === view.key ? 'active' : 'btn-secondary'}" type="button" data-view="${view.key}">
      ${view.label}
    </button>
  `).join('');

  elements.viewTabs.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentView = button.dataset.view;
      renderViewTabs();
      updateVisibleSections();
      renderPageTitle();
      if (state.currentView === 'weekly') loadWeeklyRanking();
      if (state.currentView === 'annual') loadAnnualRanking();
    });
  });
}

function updateVisibleSections() {
  elements.leaderboardSection.classList.toggle('hidden', state.currentView !== 'leaderboard');
  elements.weeklySection.classList.toggle('hidden', state.currentView !== 'weekly');
  elements.annualSection.classList.toggle('hidden', state.currentView !== 'annual');
}

function renderTrackTabs() {
  if (!state.tracks.length) {
    elements.tracks.innerHTML = '<p class="muted">No hay tracks activos todavía.</p>';
    return;
  }

  elements.tracks.innerHTML = `
    <div class="tabs">
      ${state.tracks.map((track, index) => `
        <button class="btn ${state.selectedTrack?.id === track.id || (!state.selectedTrack && index === 0) ? 'active' : 'btn-secondary'}" type="button" data-track-index="${index}">
          ${trackLabel(track)} · ${track.laps} lap${track.laps === 3 ? 's' : ''}
        </button>
      `).join('')}
    </div>
  `;

  elements.tracks.querySelectorAll('[data-track-index]').forEach((button) => {
    button.addEventListener('click', async () => {
      const track = state.tracks[Number(button.dataset.trackIndex)];
      state.selectedTrack = track;
      state.currentView = 'leaderboard';
      renderTrackTabs();
      renderViewTabs();
      updateVisibleSections();
      renderPageTitle();
      await loadLeaderboard(track);
    });
  });
}

function renderLeaderboardRows(results) {
  if (!results.length) {
    elements.tableBody.innerHTML = '<tr><td colspan="5" class="muted">No hay tiempos para los pilotos activos de la liga.</td></tr>';
    return;
  }

  elements.tableBody.innerHTML = results.map((row) => `
    <tr>
      <td data-label="#">${row.position}</td>
      <td data-label="Piloto">${row.playername || '-'}</td>
      <td data-label="País">${row.country || '-'}</td>
      <td data-label="Modelo">${row.model_name || '-'}</td>
      <td data-label="Tiempo">${row.lap_time || '-'}</td>
    </tr>
  `).join('');
}

function renderWeeklySummary(results) {
  if (!results.length) {
    elements.weeklySummaryBody.innerHTML = '<tr><td colspan="4" class="muted">Todavía no hay puntuaciones semanales.</td></tr>';
    return;
  }

  elements.weeklySummaryBody.innerHTML = results.map((row) => `
    <tr>
      <td data-label="#">${row.position}</td>
      <td data-label="Piloto">${row.pilot_name || '-'}</td>
      <td data-label="Puntos">${row.total_points}</td>
      <td data-label="Tracks puntuados">${row.scored_tracks}</td>
    </tr>
  `).join('');
}

function renderWeeklyTrackCards(tracks) {
  if (!tracks.length) {
    elements.weeklyTrackCards.innerHTML = '';
    return;
  }

  elements.weeklyTrackCards.innerHTML = tracks.map((entry) => `
    <article class="sub-card">
      <div class="sub-card-head">
        <div>
          <h3>${trackLabel(entry.track)}</h3>
          <p class="muted">${entry.track.laps} lap${entry.track.laps === 3 ? 's' : ''}${entry.track.scenery_name ? ` · ${entry.track.scenery_name}` : ''}</p>
        </div>
        <span class="pill">${entry.results.length} pilotos</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Piloto</th>
              <th>Tiempo</th>
              <th>Puntos</th>
            </tr>
          </thead>
          <tbody>
            ${entry.results.length ? entry.results.map((row) => `
              <tr>
                <td data-label="#">${row.position}</td>
                <td data-label="Piloto">${row.playername || '-'}</td>
                <td data-label="Tiempo">${row.lap_time || '-'}</td>
                <td data-label="Puntos">${row.points}</td>
              </tr>
            `).join('') : '<tr><td colspan="4" class="muted">Sin tiempos para este track.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `).join('');
}

function renderAnnualRows(results) {
  if (!results.length) {
    elements.annualBody.innerHTML = '<tr><td colspan="4" class="muted">No hay puntos anuales guardados todavía.</td></tr>';
    return;
  }

  elements.annualBody.innerHTML = results.map((row) => `
    <tr>
      <td data-label="#">${row.position}</td>
      <td data-label="Piloto">${row.pilot_name || '-'}</td>
      <td data-label="Total puntos">${row.total_points}</td>
      <td data-label="Semanas puntuadas">${row.weeks_played ?? 0}</td>
    </tr>
  `).join('');
}

async function loadLeaderboard(track) {
  elements.status.textContent = 'Cargando leaderboard…';
  elements.tableBody.innerHTML = '';

  const query = new URLSearchParams();
  query.set('laps', String(track.laps));
  if (track.is_official) {
    query.set('track_id', String(track.track_id));
  } else {
    query.set('online_id', String(track.online_id));
  }

  const response = await fetchJson(`/api/leaderboard?${query.toString()}`);
  if (!response.ok) {
    elements.status.innerHTML = `<span class="error">Error: ${response.data.error || 'No se pudo cargar el leaderboard.'}</span>`;
    return;
  }

  elements.status.textContent = `Resultados visibles: ${response.data.meta.returned_count}.`;
  renderLeaderboardRows(response.data.results || []);
}

async function loadWeeklyRanking() {
  elements.weeklyStatus.textContent = 'Calculando ranking semanal…';
  elements.weeklySummaryBody.innerHTML = '';
  elements.weeklyTrackCards.innerHTML = '';
  elements.weeklyNotice.textContent = '';

  const response = await fetchJson('/api/rankings/weekly');
  if (!response.ok) {
    elements.weeklyStatus.innerHTML = `<span class="error">Error: ${response.data.error || 'No se pudo calcular el ranking semanal.'}</span>`;
    return;
  }

  elements.weeklyStatus.textContent = `${response.data.summary?.length || 0} pilotos en el ranking semanal.`;
  elements.weeklyNotice.textContent = response.data.meta?.message || '';
  renderWeeklySummary(response.data.summary || []);
  renderWeeklyTrackCards(response.data.tracks || []);
}

async function loadAnnualRanking() {
  elements.annualStatus.textContent = 'Cargando ranking anual…';
  elements.annualBody.innerHTML = '';
  const year = Number(elements.annualYear.value) || state.annualYear;
  state.annualYear = year;

  const response = await fetchJson(`/api/rankings/annual?season_year=${encodeURIComponent(year)}`);
  if (!response.ok) {
    elements.annualStatus.innerHTML = `<span class="error">Error: ${response.data.error || 'No se pudo cargar el ranking anual.'}</span>`;
    return;
  }

  elements.annualStatus.textContent = `${response.data.results?.length || 0} pilotos con puntos guardados en ${year}.`;
  renderAnnualRows(response.data.results || []);
}

async function loadTracks() {
  elements.status.textContent = 'Cargando tracks activos…';
  const response = await fetchJson('/api/tracks/active');

  if (!response.ok) {
    elements.tracks.innerHTML = `<p class="error">${response.data.error || 'No se pudieron cargar los tracks.'}</p>`;
    elements.status.textContent = 'No se pudo cargar la información.';
    return;
  }

  state.tracks = response.data.tracks || [];
  state.selectedTrack = state.tracks[0] || null;
  renderTrackTabs();

  if (!state.selectedTrack) {
    elements.trackTitle.textContent = 'No hay track activo';
    elements.trackSubtitle.textContent = 'Activa al menos un track desde /admin.';
    elements.tableBody.innerHTML = '<tr><td colspan="5" class="muted">No hay datos disponibles.</td></tr>';
    elements.status.textContent = 'Sin tracks activos.';
    return;
  }

  renderPageTitle();
  await Promise.all([
    loadLeaderboard(state.selectedTrack),
    loadWeeklyRanking(),
    loadAnnualRanking()
  ]);
}

elements.reloadTracks.addEventListener('click', loadTracks);
elements.reloadAnnual.addEventListener('click', loadAnnualRanking);
document.addEventListener('DOMContentLoaded', () => {
  elements.annualYear.value = String(state.annualYear);
  renderLeagueHeading();
  renderViewTabs();
  updateVisibleSections();
  renderPageTitle();
  loadTracks();
});
