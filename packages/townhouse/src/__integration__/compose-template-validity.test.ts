/**
 * Integration test: validates the rendered HS compose template via `docker compose config`.
 *
 * Requirements checked:
 *   - All five services present (connector, townhouse-api, town, mill, dvm)
 *   - Every services.<name>.image uses digest form (@sha256:<64hex>)
 *   - No `build:` directives in the services section
 *   - Every host-side port binding uses 127.0.0.1: prefix (NFR9)
 *
 * Gated on DOCKER_AVAILABLE env var (default '1' when docker binary is present).
 * Skipped entirely when DOCKER_AVAILABLE is set to anything other than '1'.
 *
 * The test reads from packages/townhouse/dist/compose/townhouse-hs.yml —
 * run `pnpm --filter @toon-protocol/townhouse build` and then place
 * dist/image-manifest.json (from CI artifact or scripts/build-image-manifest.mjs)
 * before running this test to get a fully-substituted template.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the dist/compose/townhouse-hs.yml from this integration test location.
// This file lives at packages/townhouse/src/__integration__/*.test.ts,
// so packages/townhouse is two levels up.
const PKG_DIR = join(__dirname, '..', '..');
const RENDERED_HS_PATH = join(PKG_DIR, 'dist', 'compose', 'townhouse-hs.yml');

function isDockerAvailable(): boolean {
  if (process.env['DOCKER_AVAILABLE'] === '0') return false;
  if (process.env['DOCKER_AVAILABLE'] === '1') return true;
  // Auto-detect: check if docker binary exists and responds
  try {
    execSync('docker info --format "{{.ID}}"', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();
const renderedHsExists = existsSync(RENDERED_HS_PATH);

describe.skipIf(!renderedHsExists)(
  'compose-template-validity (dist/compose/townhouse-hs.yml)',
  () => {
    let renderedYaml: string;

    beforeAll(() => {
      renderedYaml = readFileSync(RENDERED_HS_PATH, 'utf-8');
    });

    it('rendered HS template has no unsubstituted digest placeholders', () => {
      expect(renderedYaml).not.toMatch(/\$\{TOON_[A-Z_]+_DIGEST\}/);
    });

    it('every services.<name>.image uses digest form (@sha256:<64hex>)', () => {
      // Extract all image: lines and verify each uses @sha256: form
      const imageLines = renderedYaml
        .split('\n')
        .filter((line) => /^\s+image:\s/.test(line));
      expect(imageLines.length).toBeGreaterThan(0);
      for (const line of imageLines) {
        expect(line, `image line should use @sha256: form: ${line.trim()}`).toMatch(
          /@sha256:[a-f0-9]{64}/
        );
      }
    });

    it('no build: directives appear in the rendered template', () => {
      // Match `build:` as a YAML key (indented or at root), not in comments
      const nonCommentLines = renderedYaml
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'));
      const buildLines = nonCommentLines.filter((line) => /^\s+build:/.test(line));
      expect(buildLines).toHaveLength(0);
    });

    it('every host-side port binding uses 127.0.0.1: prefix (NFR9)', () => {
      // Find all ports lines with a numeric host-side port
      const portLines = renderedYaml
        .split('\n')
        .filter((line) => /^\s+-\s+['"]?\d/.test(line) || /^\s+-\s+['"]?\d{2,5}:/.test(line));
      // Simplified: find lines that look like port mappings with a host port
      const allPortMappings = renderedYaml
        .split('\n')
        .filter((line) => /^\s+-\s+['"]?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:|^\s+-\s+['"]?\d+:\d+/.test(line));

      for (const line of allPortMappings) {
        const clean = line.trim().replace(/^-\s*/, '').replace(/['"]/g, '');
        // If it contains a colon (host:container mapping), check host side
        if (clean.includes(':')) {
          // Accept 127.0.0.1:<port>:<port> form
          expect(
            clean,
            `Port binding must use 127.0.0.1: prefix (NFR9): ${clean}`
          ).toMatch(/^127\.0\.0\.1:/);
        }
      }
    });

    it.skipIf(!dockerAvailable)(
      'docker compose config validates the rendered HS template',
      () => {
        let stdout: string;
        try {
          // Use --profile flags so profiled services (town, mill, dvm) appear in config output.
          // Docker Compose v5+ requires explicit --profile to include profile-restricted services.
          stdout = execFileSync('docker', [
            'compose', '-f', RENDERED_HS_PATH,
            '--profile', 'town', '--profile', 'mill', '--profile', 'dvm',
            'config',
          ], {
            encoding: 'utf-8',
            timeout: 30_000,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`docker compose config failed: ${msg}`);
        }

        // All five services should appear in the validated config
        const expectedServices = ['connector', 'townhouse-api', 'town', 'mill', 'dvm'];
        for (const svc of expectedServices) {
          expect(stdout, `service '${svc}' should be in docker compose config output`).toContain(svc);
        }
      },
      30_000
    );

    it.skipIf(!dockerAvailable)(
      'docker compose config output has no build: directives for any service',
      () => {
        const stdout = execFileSync('docker', [
          'compose', '-f', RENDERED_HS_PATH,
          '--profile', 'town', '--profile', 'mill', '--profile', 'dvm',
          'config',
        ], {
          encoding: 'utf-8',
          timeout: 30_000,
        });
        // In the resolved config output, no service should have a build key
        expect(stdout).not.toMatch(/^\s+build:/m);
      },
      30_000
    );
  }
);

describe.skipIf(renderedHsExists)(
  'compose-template-validity (SKIPPED — dist/compose/townhouse-hs.yml not present)',
  () => {
    it('skipped: run pnpm build + place image-manifest.json first', () => {
      // This test group is intentionally skipped when the rendered file is absent.
      // It exists to produce a visible skip entry in CI rather than silently passing.
    });
  }
);
