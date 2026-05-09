/**
 * Unit tests for scripts/build-image-manifest.mjs (Story 45.1).
 *
 * Tests cover: valid manifest generation, digest validation, missing-arg
 * rejection, and connector tag/digest disagreement warning behaviour.
 *
 * Run:
 *   npx vitest run --config scripts/vitest.config.ts scripts/build-image-manifest.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT = join(__dirname, 'build-image-manifest.mjs');

const MOCK_DIGESTS = {
  townhouseApi: 'sha256:aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
  town: 'sha256:1122334455667788990011223344556677889900112233445566778899001122',
  mill: 'sha256:aabbcc112233445566778899aabbcc1122334455667788990011223344556677',
  dvm: 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  connector: 'sha256:cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe',
};

const TMP_OUTPUT = join(REPO_ROOT, 'packages', 'townhouse', 'dist', '_test-image-manifest.json');

/**
 * Run the script via node with explicit args. Returns the combined output.
 */
function runScript(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, ...args],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as SpawnSyncReturns<string> & { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

function baseArgs(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    '--townhouse-version': '0.1.0',
    '--connector-tag': '3.4.1',
    '--connector-digest': MOCK_DIGESTS.connector,
    '--townhouse-api-digest': MOCK_DIGESTS.townhouseApi,
    '--town-digest': MOCK_DIGESTS.town,
    '--mill-digest': MOCK_DIGESTS.mill,
    '--dvm-digest': MOCK_DIGESTS.dvm,
    '--output': TMP_OUTPUT,
  };
  return Object.entries({ ...base, ...overrides }).flat();
}

describe('build-image-manifest.mjs', () => {
  beforeEach(() => {
    // Ensure dist dir exists (script creates it, but clean state is nice)
    mkdirSync(join(REPO_ROOT, 'packages', 'townhouse', 'dist'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_OUTPUT)) {
      unlinkSync(TMP_OUTPUT);
    }
  });

  // (a) valid manifest written with mock digests
  describe('valid manifest generation', () => {
    it('writes a v1 manifest to the output path', () => {
      const { exitCode } = runScript(baseArgs());
      expect(exitCode).toBe(0);
      expect(existsSync(TMP_OUTPUT)).toBe(true);
    });

    it('manifest has schemaVersion 1', () => {
      runScript(baseArgs());
      const manifest = JSON.parse(readFileSync(TMP_OUTPUT, 'utf-8'));
      expect(manifest.schemaVersion).toBe(1);
    });

    it('manifest contains all five image keys', () => {
      runScript(baseArgs());
      const manifest = JSON.parse(readFileSync(TMP_OUTPUT, 'utf-8'));
      const keys = Object.keys(manifest.images).sort();
      expect(keys).toEqual(['connector', 'dvm', 'mill', 'town', 'townhouse-api']);
    });

    it('manifest digests match the provided values', () => {
      runScript(baseArgs());
      const manifest = JSON.parse(readFileSync(TMP_OUTPUT, 'utf-8'));
      expect(manifest.images['townhouse-api'].digest).toBe(MOCK_DIGESTS.townhouseApi);
      expect(manifest.images.town.digest).toBe(MOCK_DIGESTS.town);
      expect(manifest.images.mill.digest).toBe(MOCK_DIGESTS.mill);
      expect(manifest.images.dvm.digest).toBe(MOCK_DIGESTS.dvm);
      expect(manifest.images.connector.digest).toBe(MOCK_DIGESTS.connector);
    });

    it('manifest records the townhouseVersion', () => {
      runScript(baseArgs({ '--townhouse-version': '1.2.3' }));
      const manifest = JSON.parse(readFileSync(TMP_OUTPUT, 'utf-8'));
      expect(manifest.townhouseVersion).toBe('1.2.3');
    });

    it('manifest connector entry records the connector tag', () => {
      runScript(baseArgs({ '--connector-tag': '3.6.1' }));
      const manifest = JSON.parse(readFileSync(TMP_OUTPUT, 'utf-8'));
      expect(manifest.images.connector.tag).toBe('3.6.1');
    });

    it('output file has a builtAt ISO timestamp', () => {
      runScript(baseArgs());
      const manifest = JSON.parse(readFileSync(TMP_OUTPUT, 'utf-8'));
      expect(() => new Date(manifest.builtAt)).not.toThrow();
      expect(new Date(manifest.builtAt).getFullYear()).toBeGreaterThanOrEqual(2026);
    });
  });

  // (b) rejects malformed digests (missing sha256: prefix)
  describe('digest validation', () => {
    it('exits non-zero for townhouse-api digest without sha256: prefix', () => {
      const { exitCode, stderr } = runScript(
        baseArgs({ '--townhouse-api-digest': 'invalid-digest' })
      );
      expect(exitCode).not.toBe(0);
      expect(stderr + '').toMatch(/sha256/);
    });

    it('exits non-zero for town digest without sha256: prefix', () => {
      const { exitCode } = runScript(
        baseArgs({ '--town-digest': 'notadigest' })
      );
      expect(exitCode).not.toBe(0);
    });

    it('exits non-zero for connector digest without sha256: prefix', () => {
      const { exitCode } = runScript(
        baseArgs({ '--connector-digest': 'latest' })
      );
      expect(exitCode).not.toBe(0);
    });
  });

  // (c) rejects when fewer than 4 townhouse digests are provided
  describe('missing digest arguments', () => {
    it('exits non-zero when --townhouse-api-digest is absent', () => {
      const args = baseArgs();
      // Remove townhouse-api-digest and its value
      const idx = args.indexOf('--townhouse-api-digest');
      args.splice(idx, 2);
      const { exitCode } = runScript(args);
      expect(exitCode).not.toBe(0);
    });

    it('exits non-zero when --mill-digest is absent', () => {
      const args = baseArgs();
      const idx = args.indexOf('--mill-digest');
      args.splice(idx, 2);
      const { exitCode } = runScript(args);
      expect(exitCode).not.toBe(0);
    });

    it('exits non-zero when --dvm-digest is absent', () => {
      const args = baseArgs();
      const idx = args.indexOf('--dvm-digest');
      args.splice(idx, 2);
      const { exitCode } = runScript(args);
      expect(exitCode).not.toBe(0);
    });

    it('exits non-zero when --town-digest is absent', () => {
      const args = baseArgs();
      const idx = args.indexOf('--town-digest');
      args.splice(idx, 2);
      const { exitCode } = runScript(args);
      expect(exitCode).not.toBe(0);
    });
  });

  // (d) connector tag/digest disagreement — warning but not fatal when both provided
  describe('connector tag/digest handling', () => {
    it('succeeds when --connector-digest is provided (skips docker manifest inspect)', () => {
      const { exitCode } = runScript(baseArgs());
      // Should succeed without needing docker
      expect(exitCode).toBe(0);
    });

    it('logs a skip message when connector-digest is provided', () => {
      const { stdout } = runScript(baseArgs());
      expect(stdout).toMatch(/connector digest provided directly/);
    });
  });
});
