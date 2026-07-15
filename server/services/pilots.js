import { createHttpError } from '../utils/http.js';
import { toBoolean } from '../utils/normalize.js';

export function validatePilotRegistrationInput(input = {}) {
  const name = String(input.name || '').trim();
  if (name.length < 2) {
    throw createHttpError(400, 'El nombre del piloto debe tener al menos 2 caracteres.');
  }

  if (name.length > 80) {
    throw createHttpError(400, 'El nombre del piloto no puede superar los 80 caracteres.');
  }

  return {
    name,
    country: null
  };
}

export function validatePilotStatusInput(input = {}) {
  if (input.active === undefined) {
    throw createHttpError(400, 'Debes indicar si el piloto queda activo o inactivo.');
  }

  return {
    active: toBoolean(input.active)
  };
}
