// Verifies that the generated CSP in dist/index.html covers every inline script.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/);

if (!meta) {
  console.error('FAIL: no Content-Security-Policy meta tag found');
  process.exit(1);
}

const csp = meta[1].replace(/&quot;/g, '"');
console.log('CSP:\n' + csp + '\n');

const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
let match;
let matched = 0;
let unmatched = 0;

while ((match = scriptRe.exec(html)) !== null) {
  if (/\bsrc\s*=/i.test(match[1])) continue;
  const normalized = match[2].replace(/\r\n/g, '\n');
  const hash = "'sha256-" + createHash('sha256').update(normalized, 'utf8').digest('base64') + "'";
  if (csp.includes(hash)) matched++;
  else {
    unmatched++;
    console.error('FAIL: inline script not allow-listed');
  }
}

// The Steam endpoints must always be reachable; a typo here silently breaks
// confirmations with no other signal.
for (const origin of [
  'https://api.steampowered.com',
  'https://steamcommunity.com',
  'https://login.steampowered.com'
]) {
  if (!csp.includes(origin)) {
    console.error(`FAIL: connect-src is missing ${origin}`);
    process.exit(1);
  }
}

for (const directive of ['object-src', 'base-uri', 'require-trusted-types-for']) {
  if (!csp.includes(directive)) {
    console.error(`FAIL: CSP is missing the ${directive} directive`);
    process.exit(1);
  }
}

if (csp.includes("script-src 'self' 'unsafe-inline'")) {
  console.error('FAIL: script-src must not allow unsafe-inline');
  process.exit(1);
}

console.log(`inline scripts: ${matched} hash-matched, ${unmatched} unmatched`);
process.exit(unmatched === 0 ? 0 : 1);