/**
 * Verifies that en.json, tr.json and ru.json expose exactly the same keys.
 *
 * A missing key in one language silently falls back to English at runtime, which
 * is exactly the "mixed language UI" problem this check prevents.
 *
 * Run with: node scripts/check-i18n.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = resolve(HERE, '../src/i18n');

const BASE = 'en';
const languages = ['tr', 'ru'];

function load(lang) {
  const path = resolve(I18N_DIR, `${lang}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** i18next treats "." inside a key as a namespace separator by default. */
function collect(obj, prefix = '', out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collect(value, full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const baseKeys = new Set(collect(load(BASE)));
let failed = false;

for (const lang of languages) {
  const keys = new Set(collect(load(lang)));
  const missing = [...baseKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !baseKeys.has(k));
  const empty = [...keys].filter((k) => {
    const value = load(lang)[k];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missing.length || extra.length || empty.length) {
    failed = true;
    console.error(`\n${lang}.json`);
    if (missing.length) console.error(`  missing (${missing.length}): ${missing.join(', ')}`);
    if (extra.length) console.error(`  unknown (${extra.length}): ${extra.join(', ')}`);
    if (empty.length) console.error(`  empty (${empty.length}): ${empty.join(', ')}`);
  } else {
    console.log(`${lang}.json OK (${keys.size} keys)`);
  }
}

if (!baseKeys.size) {
  console.error('en.json has no keys; is the file valid?');
  process.exit(1);
}

console.log(`\n${BASE}.json: ${baseKeys.size} keys`);

if (failed) {
  console.error('\nTranslation files are out of sync.');
  process.exit(1);
}

console.log('All translation files are in sync.');