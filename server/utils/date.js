export const SPAIN_TIMEZONE = "Europe/Madrid";

function getPartsInSpain(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: SPAIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

export function getSpainDateParts(date = new Date()) {
  const parts = getPartsInSpain(date);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function getSpainOffsetMinutes(date = new Date()) {
  const spain = getSpainDateParts(date);
  const localAsUtc = Date.UTC(spain.year, spain.month - 1, spain.day, spain.hour, spain.minute, spain.second);
  const actualUtc = date.getTime();
  return Math.round((localAsUtc - actualUtc) / 60000);
}

function formatOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

export function toSpainOffsetIso(date = new Date()) {
  const spain = getSpainDateParts(date);
  const offset = formatOffset(getSpainOffsetMinutes(date));
  return `${spain.year}-${String(spain.month).padStart(2, '0')}-${String(spain.day).padStart(2, '0')}T${String(spain.hour).padStart(2, '0')}:${String(spain.minute).padStart(2, '0')}:${String(spain.second).padStart(2, '0')}${offset}`;
}

export function formatSpainDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: SPAIN_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

export function formatSpainDateTimeFromIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatSpainDateTime(date);
}

export function getIsoWeekInfo(date = new Date()) {
  const spain = getSpainDateParts(date);
  const utcDate = new Date(Date.UTC(spain.year, spain.month - 1, spain.day));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  const seasonYear = utcDate.getUTCFullYear();
  const weekKey = `${seasonYear}-W${String(weekNumber).padStart(2, '0')}`;

  return {
    seasonYear,
    weekNumber,
    weekKey
  };
}
