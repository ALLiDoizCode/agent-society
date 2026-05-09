#!/usr/bin/env node
/**
 * Render packages/townhouse/compose/townhouse-hs.yml against the digest
 * values in packages/townhouse/dist/image-manifest.json and write the
 * result to packages/townhouse/dist/compose/townhouse-hs.yml.
 *
 * Also copies packages/townhouse/compose/townhouse-dev.yml verbatim to
 * packages/townhouse/dist/compose/townhouse-dev.yml.
 *
 * This script is callable from CI AFTER actions/download-artifact drops
 * image-manifest.json into packages/townhouse/dist/. That two-step sequence
 * (build → download-artifact → render) avoids the tsup clean:true issue where
 * a full `pnpm build` would wipe dist/ (and the just-placed manifest) on start.
 *
 * Usage (CI):
 *   node scripts/render-compose-template.mjs
 *
 * Usage (local smoke test — manifest must exist in dist/ first):
 *   cp /tmp/45-1-artifact/image-manifest.json packages/townhouse/dist/
 *   node scripts/render-compose-template.mjs
 */

import { readFile, writeFile, cp, mkdir, access, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getImageDigest } from './lib/image-manifest-digest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PKG_DIR = join(REPO_ROOT, 'packages', 'townhouse');
const COMPOSE_SRC_DIR = join(PKG_DIR, 'compose');
const DIST_DIR = join(PKG_DIR, 'dist');
const COMPOSE_DIST_DIR = join(DIST_DIR, 'compose');
const MANIFEST_PATH = join(DIST_DIR, 'image-manifest.json');
const HS_TEMPLATE_PATH = join(COMPOSE_SRC_DIR, 'townhouse-hs.yml');
const DEV_TEMPLATE_PATH = join(COMPOSE_SRC_DIR, 'townhouse-dev.yml');

async function run() {
  await mkdir(COMPOSE_DIST_DIR, { recursive: true });

  // Copy dev template verbatim — no digest substitution (uses local toon:* tags).
  await cp(DEV_TEMPLATE_PATH, join(COMPOSE_DIST_DIR, 'townhouse-dev.yml'));

  const hsTemplateRaw = await readFile(HS_TEMPLATE_PATH, 'utf-8');
  let hsRendered = hsTemplateRaw;

  // Only ENOENT on the manifest is tolerated (warn + ship unsubstituted).
  // JSON-parse errors, missing image keys, and malformed digests all fail
  // hard — silent emission of an unsubstituted template under those
  // conditions would mask real bugs.
  let manifestPresent = false;
  try {
    await access(MANIFEST_PATH);
    manifestPresent = true;
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
    console.warn(
      '[render-compose-template] WARNING: dist/image-manifest.json not found — ' +
      'shipping unsubstituted townhouse-hs.yml. ' +
      'This is fine for local dev but invalid for npm publish.'
    );
  }

  if (manifestPresent) {
    const manifestRaw = await readFile(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(manifestRaw); // throws SyntaxError on malformed JSON

    const subs = [
      ['${TOON_TOWNHOUSE_API_DIGEST}', getImageDigest(manifest, 'townhouse-api')],
      ['${TOON_TOWN_DIGEST}',          getImageDigest(manifest, 'town')],
      ['${TOON_MILL_DIGEST}',          getImageDigest(manifest, 'mill')],
      ['${TOON_DVM_DIGEST}',           getImageDigest(manifest, 'dvm')],
      ['${TOON_CONNECTOR_DIGEST}',     getImageDigest(manifest, 'connector')],
    ];

    for (const [placeholder, digest] of subs) {
      hsRendered = hsRendered.replaceAll(placeholder, `@${digest}`);
    }

    console.log('[render-compose-template] HS template rendered with 5 digest substitutions.');
  }

  const hsOutPath = join(COMPOSE_DIST_DIR, 'townhouse-hs.yml');
  await writeFile(hsOutPath, hsRendered, 'utf-8');
  // NFR8 — operator-secret file mode (the rendered HS YAML embeds env-var
  // references that may include private keys at deploy time). The mode
  // applies to the build artifact in dist/ as well as the materialized copy
  // at ~/.townhouse/compose/, so an untrusted local user on the CI runner
  // cannot read between render and pack.
  await chmod(hsOutPath, 0o600);
  console.log('[render-compose-template] Done — dist/compose/{townhouse-hs,townhouse-dev}.yml written.');
}

run().catch((err) => {
  console.error('[render-compose-template] FATAL:', err.message);
  process.exit(1);
});
