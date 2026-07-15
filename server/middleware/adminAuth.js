import { config } from '../config.js';

export function extractAdminKey(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : '';

  return bearer || String(req.headers['x-admin-key'] || '').trim();
}

export function isAdminRequest(req) {
  return Boolean(config.adminKey) && extractAdminKey(req) === config.adminKey;
}

export function requireAdmin(req, res, next) {
  if (!config.adminKey) {
    return res.status(503).json({
      error: 'ADMIN_KEY no está configurada en el servidor.'
    });
  }

  if (!isAdminRequest(req)) {
    return res.status(401).json({
      error: 'No autorizado. Falta una ADMIN_KEY válida.'
    });
  }

  next();
}
