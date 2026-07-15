import 'dotenv/config';

function asList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNullableNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

export const config = {
  timezone: process.env.TZ || 'Europe/Madrid',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: asNumber(process.env.PORT, 10000),
  adminKey: process.env.ADMIN_KEY || '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  allowedOrigins: asList(process.env.ALLOWED_ORIGINS),
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRole: process.env.SUPABASE_SERVICE_ROLE || ''
  },
  velocidrone: {
    apiUrl: process.env.VELO_API_URL || 'https://velocidrone.co.uk/api/leaderboard',
    apiToken: process.env.VELO_API_TOKEN || '',
    simVersion: process.env.SIM_VERSION || '1.16',
    cacheTtlMs: asNumber(process.env.CACHE_TTL_MS, 10 * 60 * 1000)
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    allowedChatIds: asList(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    topAutopostEnabled: asBoolean(process.env.TELEGRAM_TOP_AUTOPOST_ENABLED, true),
    topAutopostIntervalMinutes: asNumber(process.env.TELEGRAM_TOP_INTERVAL_MINUTES, 360),
    topAutopostOnBoot: asBoolean(process.env.TELEGRAM_TOP_AUTOPOST_ON_BOOT, false),
    improvementMonitorEnabled: asBoolean(process.env.TELEGRAM_IMPROVEMENT_MONITOR_ENABLED, true),
    improvementIntervalMinutes: asNumber(process.env.TELEGRAM_IMPROVEMENT_INTERVAL_MINUTES, 15),
    improvementMonitorOnBoot: asBoolean(process.env.TELEGRAM_IMPROVEMENT_MONITOR_ON_BOOT, false),
    topThreadId: asNullableNumber(process.env.TELEGRAM_TOPIC_TOP_THREAD_ID, 2),
    supertopThreadId: asNullableNumber(process.env.TELEGRAM_TOPIC_SUPERTOP_THREAD_ID, 3),
    tracksThreadId: asNullableNumber(process.env.TELEGRAM_TOPIC_TRACKS_THREAD_ID, 4)
  }
};

export function getConfigSummary() {
  return {
    nodeEnv: config.nodeEnv,
    port: config.port,
    configured: {
      adminKey: Boolean(config.adminKey),
      publicBaseUrl: Boolean(config.publicBaseUrl),
      supabaseUrl: Boolean(config.supabase.url),
      supabaseServiceRole: Boolean(config.supabase.serviceRole),
      veloApiToken: Boolean(config.velocidrone.apiToken),
      telegramBotToken: Boolean(config.telegram.botToken),
      telegramWebhookSecret: Boolean(config.telegram.webhookSecret),
      allowedOrigins: config.allowedOrigins.length,
      telegramAllowedChatIds: config.telegram.allowedChatIds.length,
      telegramTopAutopostEnabled: config.telegram.topAutopostEnabled,
      telegramTopAutopostIntervalMinutes: config.telegram.topAutopostIntervalMinutes,
      telegramTopAutopostOnBoot: config.telegram.topAutopostOnBoot,
      telegramImprovementMonitorEnabled: config.telegram.improvementMonitorEnabled,
      telegramImprovementIntervalMinutes: config.telegram.improvementIntervalMinutes,
      telegramImprovementMonitorOnBoot: config.telegram.improvementMonitorOnBoot,
      telegramTopThreadId: config.telegram.topThreadId,
      telegramSupertopThreadId: config.telegram.supertopThreadId,
      telegramTracksThreadId: config.telegram.tracksThreadId,
      timezone: config.timezone
    }
  };
}
