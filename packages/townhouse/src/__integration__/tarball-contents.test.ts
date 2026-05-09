/**
 * Integration test: verifies that `pnpm pack` produces a tarball containing
 * the three required artifacts:
 *   - package/dist/compose/townhouse-hs.yml
 *   - package/dist/compose/townhouse-dev.yml
 *   - package/dist/image-manifest.json
 *
 * Also asserts the HS YAML in the tarball contains no unsubstituted placeholders
 * and that every image: line uses digest form (@sha256:).
 *
 * Skip conditions:
 *   - SKIP_PACK_TEST=1 : developer explicitly skips (no dist/ rebuild needed)
 *   - dist/image-manifest.json absent at test start : local dev path where
 *     manifest hasn't been placed yet. The tarball-content check for image-manifest.json
 *     is skipped but the compose file assertions still run.
 *
 * In CI: dist/image-manifest.json is placed by the download-artifact step +
 * render step BEFORE this test runs, so all assertions run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PKG_DIR = join(__dirname, '..', '..');
const MANIFEST_PATH = join(PKG_DIR, 'dist', 'image-manifest.json');

const skipPackTest = process.env['SKIP_PACK_TEST'] === '1';
const manifestPresent = existsSync(MANIFEST_PATH);

describe.skipIf(skipPackTest)('tarball-contents', () => {
  let packOutDir: string;
  let extractDir: string;
  let tgzPath: string;

  beforeAll(() => {
    packOutDir = mkdtempSync(join(tmpdir(), 'townhouse-pack-'));
    extractDir = mkdtempSync(join(tmpdir(), 'townhouse-extract-'));

    // Run pnpm pack from the package directory
    const result = execFileSync(
      'pnpm',
      ['pack', '--pack-destination', packOutDir],
      { cwd: PKG_DIR, encoding: 'utf-8', timeout: 60_000 }
    );

    // Find the produced .tgz
    const tgzName = result.trim().split('\n').pop()?.trim();
    // pnpm pack outputs the path to the tgz
    if (tgzName && existsSync(tgzName)) {
      tgzPath = tgzName;
    } else {
      // fallback: find in packOutDir
      const files = readdirSync(packOutDir).filter((f) => f.endsWith('.tgz'));
      expect(files.length, 'expected exactly one .tgz in pack output dir').toBe(1);
      tgzPath = join(packOutDir, files[0]!);
    }

    // Extract the tarball
    execFileSync('tar', ['-xzf', tgzPath, '-C', extractDir], { timeout: 30_000 });
  }, 90_000);

  afterAll(() => {
    if (packOutDir) rmSync(packOutDir, { recursive: true, force: true });
    if (extractDir) rmSync(extractDir, { recursive: true, force: true });
  });

  it('tarball contains package/dist/compose/townhouse-hs.yml', () => {
    const hsPath = join(extractDir, 'package', 'dist', 'compose', 'townhouse-hs.yml');
    expect(existsSync(hsPath), `expected ${hsPath} to exist in tarball`).toBe(true);
  });

  it('tarball contains package/dist/compose/townhouse-dev.yml', () => {
    const devPath = join(extractDir, 'package', 'dist', 'compose', 'townhouse-dev.yml');
    expect(existsSync(devPath), `expected ${devPath} to exist in tarball`).toBe(true);
  });

  it.skipIf(!manifestPresent)(
    'tarball contains package/dist/image-manifest.json (skipped when manifest absent locally)',
    () => {
      const manifestInTarball = join(extractDir, 'package', 'dist', 'image-manifest.json');
      expect(existsSync(manifestInTarball), `expected ${manifestInTarball} to exist in tarball`).toBe(true);
    }
  );

  it('tarball HS YAML has no unsubstituted placeholders', () => {
    const hsPath = join(extractDir, 'package', 'dist', 'compose', 'townhouse-hs.yml');
    if (!existsSync(hsPath)) return; // covered by previous test
    const content = readFileSync(hsPath, 'utf-8');
    expect(content, 'HS YAML in tarball must not contain unsubstituted placeholders').not.toMatch(
      /\$\{TOON_[A-Z_]+_DIGEST\}/
    );
  });

  it.skipIf(!manifestPresent)(
    'tarball HS YAML has @sha256: digest form for every image: line (skipped when manifest absent)',
    () => {
      const hsPath = join(extractDir, 'package', 'dist', 'compose', 'townhouse-hs.yml');
      if (!existsSync(hsPath)) return;
      const content = readFileSync(hsPath, 'utf-8');
      const imageLines = content.split('\n').filter((l) => /^\s+image:\s/.test(l));
      expect(imageLines.length).toBeGreaterThan(0);
      for (const line of imageLines) {
        expect(line, `image line must use @sha256: form: ${line.trim()}`).toMatch(
          /@sha256:[a-f0-9]{64}/
        );
      }
    }
  );
});
