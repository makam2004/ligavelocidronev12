async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, data: { raw: text } };
  }
}

const els = {
  pilotName: document.getElementById('pilotName'),
  submitPilot: document.getElementById('submitPilot'),
  pilotSignupResult: document.getElementById('pilotSignupResult')
};

function setResult(message, tone = 'muted') {
  els.pilotSignupResult.className = `result-box ${tone}`;
  els.pilotSignupResult.textContent = message;
}

async function submitPilot() {
  const payload = {
    name: els.pilotName.value.trim()
  };

  const response = await fetchJson('/api/pilots/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.ok) {
    setResult(response.data.message || 'Pendiente de aprobación por el administrador.', 'success');
    els.pilotName.value = '';
    return;
  }

  setResult(response.data.error || 'No se pudo enviar la solicitud.', 'error');
}

els.submitPilot.addEventListener('click', submitPilot);
