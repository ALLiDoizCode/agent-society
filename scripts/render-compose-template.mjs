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

import { readFile, writeFile, cp, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  try {
    await access(MANIFEST_PATH);
    const manifestRaw = await readFile(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(manifestRaw);

    const subs = [
      ['${TOON_TOWNHOUSE_API_DIGEST}', `@${manifest.images['townhouse-api'].digest}`],
      ['${TOON_TOWN_DIGEST}',          `@${manifest.images.town.digest}`],
      ['${TOON_MILL_DIGEST}',          `@${manifest.images.mill.digest}`],
      ['${TOON_DVM_DIGEST}',           `@${manifest.images.dvm.digest}`],
      ['${TOON_CONNECTOR_DIGEST}',     `@${manifest.images.connector.digest}`],
    ];

    for (const [placeholder, replacement] of subs) {
      hsRendered = hsRendered.replaceAll(placeholder, replacement);
    }

    console.log('[render-compose-template] HS template rendered with 5 digest substitutions.');
  } catch (err) {
    // Manifest absent — ship unsubstituted template with a loud warning.
    // Acceptable for local dev; the tarball-content verification step in CI
    // catches unsubstituted placeholders before pnpm publish runs.
    console.warn(
      '[render-compose-template] WARNING: dist/image-manifest.json not found — ' +
      'shipping unsubstituted townhouse-hs.yml. ' +
      'This is fine for local dev but invalid for npm publish.'
    );
  }

  await writeFile(join(COMPOSE_DIST_DIR, 'townhouse-hs.yml'), hsRendered, 'utf-8');
  console.log('[render-compose-template] Done — dist/compose/{townhouse-hs,townhouse-dev}.yml written.');
}

run().catch((err) => {
  console.error('[render-compose-template] FATAL:', err.message);
  process.exit(1);
});
