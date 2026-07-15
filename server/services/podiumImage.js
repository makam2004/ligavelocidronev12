import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.resolve(__dirname, '../public/assets/commit-podium.jpeg');

const FONT = {
  'A':['01110','10001','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01111','10000','10000','10000','10000','10000','01111'],
  'D':['11110','10001','10001','10001','10001','10001','11110'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01111','10000','10000','10011','10001','10001','01110'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['11111','00100','00100','00100','00100','00100','11111'],
  'J':['00001','00001','00001','00001','10001','10001','01110'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],
  'N':['10001','10001','11001','10101','10011','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','10101','01010'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '_':['00000','00000','00000','00000','00000','00000','11111'],
  '.':['00000','00000','00000','00000','00000','01100','01100'],
  ':':['00000','01100','01100','00000','01100','01100','00000'],
  '/':['00001','00010','00100','01000','10000','00000','00000'],
  '(':['00010','00100','01000','01000','01000','00100','00010'],
  ')':['01000','00100','00010','00010','00010','00100','01000'],
  '&':['01100','10010','10100','01000','10101','10010','01101'],
  "'":['00100','00100','00000','00000','00000','00000','00000'],
  '?':['01110','10001','00010','00100','00100','00000','00100'],
  '!':['00100','00100','00100','00100','00100','00000','00100'],
  ',':['00000','00000','00000','00000','01100','01100','00100'],
  '+':['00000','00100','00100','11111','00100','00100','00000'],
  '—':['11111','11111','11111','11111','11111','11111','11111']
};

function normalize(input = '') {
  return String(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 \-_.:\/()&'?!,+]/g, '?')
    .trim() || '—';
}

function charWidth(scale, gap) {
  return 5 * scale + gap * scale;
}

function textWidth(text, scale = 1, gap = 1) {
  const chars = [...text];
  if (!chars.length) return 0;
  return chars.length * charWidth(scale, gap) - gap * scale;
}

function splitLongWord(word, maxChars) {
  if (word.length <= maxChars) return [word];
  const parts = [];
  let rest = word;
  while (rest.length > maxChars) {
    parts.push(`${rest.slice(0, Math.max(1, maxChars - 1))}…`);
    rest = rest.slice(Math.max(1, maxChars - 1));
  }
  if (rest) parts.push(rest);
  return parts;
}

function wrapText(input, maxWidthPx, scale, gap = 1, maxLines = 2) {
  const normalized = normalize(input);
  const maxChars = Math.max(3, Math.floor(maxWidthPx / charWidth(scale, gap)));
  const words = normalized.split(/\s+/).flatMap((word) => splitLongWord(word, maxChars));

  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || textWidth(candidate, scale, gap) <= maxWidthPx) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (!lines.length) lines.push('—');

  const consumed = lines.join(' ').trim();
  if (normalized.length > consumed.length && lines.length) {
    const lastIndex = lines.length - 1;
    const maxLastChars = Math.max(2, maxChars - 1);
    lines[lastIndex] = `${lines[lastIndex].slice(0, maxLastChars).trim()}…`;
  }

  return lines.slice(0, maxLines);
}

function fitScale(text, maxWidth, preferredScale, minScale, gap = 1, maxLines = 2) {
  for (let scale = preferredScale; scale >= minScale; scale -= 1) {
    const lines = wrapText(text, maxWidth, scale, gap, maxLines);
    if (lines.length <= maxLines && lines.every((line) => textWidth(line, scale, gap) <= maxWidth)) {
      return scale;
    }
  }
  return minScale;
}

function renderBitmapText({
  text,
  x,
  y,
  maxWidth,
  scale,
  gap = 1,
  color,
  strokeColor,
  strokePx,
  maxLines = 2,
}) {
  const lines = wrapText(text, maxWidth, scale, gap, maxLines);
  const lineHeight = 7 * scale + 3 * scale;
  const rects = [];

  lines.forEach((line, lineIndex) => {
    const lineW = textWidth(line, scale, gap);
    let cursorX = x + (maxWidth - lineW) / 2;
    const baseY = y + lineIndex * lineHeight;

    for (const rawChar of [...line]) {
      const glyph = FONT[rawChar] || FONT['?'];
      glyph.forEach((row, rowIndex) => {
        [...row].forEach((bit, colIndex) => {
          if (bit !== '1') return;
          const rx = Math.round(cursorX + colIndex * scale);
          const ry = Math.round(baseY + rowIndex * scale);
          rects.push(`<rect x="${rx - strokePx}" y="${ry - strokePx}" width="${scale + strokePx * 2}" height="${scale + strokePx * 2}" fill="${strokeColor}"/>`);
          rects.push(`<rect x="${rx}" y="${ry}" width="${scale}" height="${scale}" fill="${color}"/>`);
        });
      });
      cursorX += charWidth(scale, gap);
    }
  });

  return rects.join('');
}

function textGroup(text, box, options) {
  const scale = fitScale(text, box.textWidth, options.preferredScale, options.minScale, options.gap, options.maxLines);
  const lineHeight = 7 * scale + 3 * scale;
  const lines = wrapText(text, box.textWidth, scale, options.gap, options.maxLines);
  const totalHeight = lines.length * 7 * scale + Math.max(0, lines.length - 1) * 3 * scale;
  const textY = Math.round(box.y + (box.h - totalHeight) / 2);
  return renderBitmapText({
    text,
    x: box.x + box.paddingX,
    y: textY,
    maxWidth: box.textWidth,
    scale,
    gap: options.gap,
    color: options.color,
    strokeColor: options.strokeColor,
    strokePx: options.strokePx,
    maxLines: options.maxLines,
  });
}

function buildOverlay({ width, height, trackName, firstPilot, secondPilot, thirdPilot }) {
  const titleBox = { x: 48, y: 38, w: width - 96, h: 150, paddingX: 42, textWidth: width - 180 };
  const firstBox = { x: 338, y: 430, w: 340, h: 116, paddingX: 26, textWidth: 288 };
  const secondBox = { x: 50, y: 600, w: 274, h: 108, paddingX: 22, textWidth: 230 };
  const thirdBox = { x: 700, y: 600, w: 274, h: 108, paddingX: 22, textWidth: 230 };

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="${titleBox.x}" y="${titleBox.y}" width="${titleBox.w}" height="${titleBox.h}" rx="26" ry="26" fill="rgba(13,31,46,0.82)" stroke="rgba(255,230,150,0.95)" stroke-width="6"/>
      ${textGroup(trackName || 'TRACK SEMANAL', titleBox, {
        preferredScale: 6,
        minScale: 3,
        gap: 1,
        maxLines: 2,
        color: '#FFE89A',
        strokeColor: '#06121A',
        strokePx: 2,
      })}

      <rect x="${firstBox.x}" y="${firstBox.y}" width="${firstBox.w}" height="${firstBox.h}" rx="22" ry="22" fill="rgba(20,30,40,0.78)" stroke="rgba(255,255,255,0.95)" stroke-width="4"/>
      ${textGroup(firstPilot || '—', firstBox, {
        preferredScale: 5,
        minScale: 3,
        gap: 1,
        maxLines: 2,
        color: '#FFF2B8',
        strokeColor: '#081018',
        strokePx: 2,
      })}

      <rect x="${secondBox.x}" y="${secondBox.y}" width="${secondBox.w}" height="${secondBox.h}" rx="22" ry="22" fill="rgba(20,30,40,0.78)" stroke="rgba(255,255,255,0.95)" stroke-width="4"/>
      ${textGroup(secondPilot || '—', secondBox, {
        preferredScale: 5,
        minScale: 3,
        gap: 1,
        maxLines: 2,
        color: '#FFFFFF',
        strokeColor: '#081018',
        strokePx: 2,
      })}

      <rect x="${thirdBox.x}" y="${thirdBox.y}" width="${thirdBox.w}" height="${thirdBox.h}" rx="22" ry="22" fill="rgba(20,30,40,0.78)" stroke="rgba(255,255,255,0.95)" stroke-width="4"/>
      ${textGroup(thirdPilot || '—', thirdBox, {
        preferredScale: 5,
        minScale: 3,
        gap: 1,
        maxLines: 2,
        color: '#FFFFFF',
        strokeColor: '#081018',
        strokePx: 2,
      })}
    </svg>
  `;
}

export async function buildTrackPodiumImage({ trackName, firstPilot, secondPilot, thirdPilot }) {
  const template = sharp(templatePath);
  const metadata = await template.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1536;

  const overlaySvg = buildOverlay({ width, height, trackName, firstPilot, secondPilot, thirdPilot });

  return template
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 94 })
    .toBuffer();
}
