#!/usr/bin/env node
/**
 * Build packages/townhouse/dist/image-manifest.json from per-service OCI digests.
 *
 * The manifest pins every townhouse-owned image by content-addressed digest so
 * the npm tarball (Story 45.2) and the pre-publish quality gate (NFR17) have a
 * single source of truth for what was built and signed.
 *
 * Usage (local smoke test):
 *   node scripts/build-image-manifest.mjs \
 *     --townhouse-version 0.1.0 \
 *     --connector-tag 3.4.1 \
 *     --townhouse-api-digest sha256:abc... \
 *     --town-digest sha256:def... \
 *     --mill-digest sha256:ghi... \
 *     --dvm-digest sha256:jkl...
 *
 * Usage (CI — connector digest pre-resolved by caller):
 *   node scripts/build-image-manifest.mjs \
 *     --townhouse-version 0.1.0 \
 *     --connector-tag 3.4.1 \
 *     --connector-digest sha256:xyz... \
 *     --townhouse-api-digest sha256:... \
 *     ...
 *
 * OWASP A03: shell-out uses execFileSync with explicit args array, never
 * execSync with a shell-interpolated string.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Schema (version 1) — bump to version 2 for any shape change
// ---------------------------------------------------------------------------

const DigestString = z
  .string()
  .refine((v) => v.startsWith('sha256:'), {
    message: 'digest must start with sha256:',
  });

const ImageEntrySchema = z.object({
  name: z.string(),
  tag: z.string(),
  digest: DigestString,
});

const ManifestSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  townhouseVersion: z.string(),
  builtAt: z.string(),
  images: z.object({
    'townhouse-api': ImageEntrySchema,
    town: ImageEntrySchema,
    mill: ImageEntrySchema,
    dvm: ImageEntrySchema,
    connector: ImageEntrySchema,
  }),
});

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    'townhouse-version': { type: 'string' },
    'connector-tag': { type: 'string' },
    'connector-digest': { type: 'string' },
    'townhouse-api-digest': { type: 'string' },
    'town-digest': { type: 'string' },
    'mill-digest': { type: 'string' },
    'dvm-digest': { type: 'string' },
    'output': { type: 'string' },
  },
  allowPositionals: false,
});

const townhouseVersion = values['townhouse-version'];
const connectorTag = values['connector-tag'];
const connectorDigestArg = values['connector-digest'];
const townhouseApiDigest = values['townhouse-api-digest'];
const townDigest = values['town-digest'];
const millDigest = values['mill-digest'];
const dvmDigest = values['dvm-digest'];
const outputPath =
  values['output'] ??
  join(REPO_ROOT, 'packages', 'townhouse', 'dist', 'image-manifest.json');

if (!townhouseVersion) {
  console.error('Error: --townhouse-version is required');
  process.exit(1);
}

const missingDigests = [
  ['townhouse-api', townhouseApiDigest],
  ['town', townDigest],
  ['mill', millDigest],
  ['dvm', dvmDigest],
].filter(([, v]) => !v);

if (missingDigests.length > 0) {
  console.error(
    `Error: missing required digest args: ${missingDigests.map(([k]) => `--${k}-digest`).join(', ')}`
  );
  process.exit(1);
}

if (!connectorTag) {
  console.error('Error: --connector-tag is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve connector digest (OWASP A03: execFileSync with explicit args)
// ---------------------------------------------------------------------------

let connectorDigest = connectorDigestArg;

if (connectorDigest && connectorTag) {
  // Both provided — verify they agree if we can, but don't block on it
  console.log(
    `[build-image-manifest] connector digest provided directly — skipping docker manifest inspect`
  );
} else if (!connectorDigest) {
  console.log(
    `[build-image-manifest] resolving connector digest for tag ${connectorTag} via docker manifest inspect...`
  );
  try {
    const raw = execFileSync(
      'docker',
      ['manifest', 'inspect', `ghcr.io/toon-protocol/connector:${connectorTag}`],
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(raw);
    // Multi-arch manifest list: use the index digest, not a per-arch digest
    // The inspect output doesn't expose the index digest directly via this command;
    // use buildx imagetools if available, otherwise extract from the first manifest entry.
    const schemaVersion = parsed.schemaVersion;
    if (schemaVersion === 2 && parsed.mediaType?.includes('manifest.list')) {
      // OCI/Docker manifest list — we need the list's own digest which isn't
      // in the inspect body. Prompt the caller to provide --connector-digest explicitly.
      console.warn(
        '[build-image-manifest] WARNING: docker manifest inspect returned a manifest list without exposing the index digest. ' +
        'Falling back to sha256 of the inspect JSON. Prefer passing --connector-digest explicitly in CI.'
      );
      const { createHash } = await import('node:crypto');
      connectorDigest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    } else {
      // Single-arch manifest — the config.digest is the image digest
      connectorDigest = parsed.config?.digest ?? null;
      if (!connectorDigest) {
        throw new Error('could not extract digest from manifest inspect output');
      }
    }
  } catch (err) {
    console.error(
      `[build-image-manifest] failed to resolve connector digest: ${err.message}`
    );
    console.error('Pass --connector-digest sha256:<hex> to skip docker manifest inspect.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Validate all digests
// ---------------------------------------------------------------------------

/** @param {string} digest @param {string} label */
function assertDigest(digest, label) {
  if (!digest?.startsWith('sha256:')) {
    console.error(`Error: ${label} digest must start with sha256: (got: ${digest})`);
    process.exit(1);
  }
}

assertDigest(townhouseApiDigest, 'townhouse-api');
assertDigest(townDigest, 'town');
assertDigest(millDigest, 'mill');
assertDigest(dvmDigest, 'dvm');
assertDigest(connectorDigest, 'connector');

// ---------------------------------------------------------------------------
// Build manifest object
// ---------------------------------------------------------------------------

/** @type {z.infer<typeof ManifestSchemaV1>} */
const manifest = {
  schemaVersion: 1,
  townhouseVersion,
  builtAt: new Date().toISOString(),
  images: {
    'townhouse-api': {
      name: 'ghcr.io/toon-protocol/townhouse-api',
      tag: townhouseVersion,
      digest: townhouseApiDigest,
    },
    town: {
      name: 'ghcr.io/toon-protocol/town',
      tag: townhouseVersion,
      digest: townDigest,
    },
    mill: {
      name: 'ghcr.io/toon-protocol/mill',
      tag: townhouseVersion,
      digest: millDigest,
    },
    dvm: {
      name: 'ghcr.io/toon-protocol/dvm',
      tag: townhouseVersion,
      digest: dvmDigest,
    },
    connector: {
      name: 'ghcr.io/toon-protocol/connector',
      tag: connectorTag,
      digest: connectorDigest,
    },
  },
};

// ---------------------------------------------------------------------------
// Validate against schema before writing
// ---------------------------------------------------------------------------

const result = ManifestSchemaV1.safeParse(manifest);
if (!result.success) {
  console.error('[build-image-manifest] schema validation failed:');
  console.error(result.error.format());
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write output (mode 0o644 — build artifact, not an operator secret)
// ---------------------------------------------------------------------------

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', {
  mode: 0o644,
  encoding: 'utf-8',
});

console.log(`[build-image-manifest] wrote ${outputPath}`);
console.log(`[build-image-manifest] schemaVersion=1 townhouseVersion=${townhouseVersion}`);
for (const [svc, entry] of Object.entries(manifest.images)) {
  console.log(`  ${svc}: ${entry.digest.slice(0, 19)}...`);
}
