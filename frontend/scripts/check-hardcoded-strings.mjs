/**
 * Scans .tsx sources for user-visible strings that bypass i18next.
 *
 * Only JSX text nodes, placeholder= and title= attributes and a few DOM-facing
 * props are checked. Import paths, class names and console output are ignored.
 *
 * Run with: node scripts/check-hardcoded-strings.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (extname(full) === '.tsx') files.push(full);
  }
  return files;
}

// Attributes whose value is rendered to the user.
const USER_ATTRS = ['placeholder', 'title', 'aria-label'];
// Props that are passed through to translation helpers.
const TRANSLATED_PROPS = new Set(['alias', 'message', 'name']);

/**
 * Strings that are intentionally not translated.
 * - Brand names must stay identical across locales.
 * - Language endonyms are written in their own language on purpose, so a user
 *   who cannot read the current UI can still find their language.
 */
const ALLOWED = new Set(['SteamGuard', 'English', 'Türkçe', 'Русский', 'TR', 'EN', 'RU']);

const findings = [];

for (const file of walk(SRC)) {
  if (file.endsWith('.test.tsx')) continue;

  const rel = relative(SRC, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Ignore comments and imports.
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('import ')) return;

    for (const attr of USER_ATTRS) {
      const re = new RegExp(`${attr}=(?:"([^"]+)"|'([^']+)')`);
      const m = line.match(re);
      if (!m) continue;
      const value = (m[1] ?? m[2] ?? '').trim();
      if (!value) continue;
      // Dynamic expressions ({...}) are fine; literal text is not.
      if (value.startsWith('{')) continue;
      // Pure punctuation / numbers are acceptable.
      if (!/[A-Za-zА-Яа-я]/.test(value)) continue;
      if (ALLOWED.has(value)) continue;
      findings.push({ rel, line: i + 1, kind: attr, value });
    }

    // Literal JSX text: >Some Words<  (exclude interpolations and tags).
    const textRe = />([^<>{}$]+)</g;
    let m;
    while ((m = textRe.exec(line)) !== null) {
      const value = m[1].trim();
      if (!/[A-Za-zА-Яа-я]{2,}/.test(value)) continue;
      // Skip element names and known non-copy tokens.
      if (/^[a-z-]+$/.test(value)) continue;
      if (ALLOWED.has(value)) continue;
      findings.push({ rel, line: i + 1, kind: 'text', value });
    }

    // setMessage({ text: 'literal' }) and error fallbacks.
    const msgRe = /text:\s*(?:`([^`]+)`|'([^']{4,})')/g;
    while ((m = msgRe.exec(line)) !== null) {
      const value = (m[1] ?? m[2] ?? '').trim();
      if (!value || value.includes('${')) continue;
      findings.push({ rel, line: i + 1, kind: 'message', value });
    }

    // throw new Error('literal')
    const errRe = /throw new Error\(\s*[`']([^`']{6,})[`']\s*\)/g;
    while ((m = errRe.exec(line)) !== null) {
      const value = m[1].trim();
      if (value.includes('${')) continue;
      if (!/[A-Za-zА-Яа-я]{3,}/.test(value)) continue;
      // HTTP status codes and similar tokens are fine.
      findings.push({ rel, line: i + 1, kind: 'error', value });
    }
  });
}

if (!findings.length) {
  console.log('No hardcoded user-facing strings found.');
  process.exit(0);
}

console.error(`Found ${findings.length} hardcoded user-facing string(s):\n`);
for (const f of findings) {
  console.error(`  ${f.rel}:${f.line}  [${f.kind}]  ${f.value}`);
}
console.error('\nMove these into i18n/en.json, i18n/tr.json and i18n/ru.json.');
process.exit(1);