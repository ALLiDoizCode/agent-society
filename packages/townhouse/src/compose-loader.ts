import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export type ComposeProfile = 'dev' | 'hs';

export interface ComposeLoaderOptions {
  /** Override default `~/.townhouse/` write target. Used by tests. */
  townhouseHome?: string;
  /** Override the package-relative dist directory the loader reads from.
   *  Defaults to the `dist/` adjacent to compose-loader.js at runtime.
   *  Tests use this to point at fixture directories. */
  distDir?: string;
}

export class ComposeLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeLoaderError';
  }
}

function defaultDistDir(): string {
  // Resolves to `dist/` adjacent to the bundled output at runtime.
  // When bundled by tsup, import.meta.url is the path of dist/index.js,
  // so dirname = <package>/dist. resolve(<package>/dist, '..', 'dist') = <package>/dist.
  // When running via tsx/ts-node from src/, dirname = <package>/src,
  // so resolve(<package>/src, '..', 'dist') = <package>/dist. Both work.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'dist');
}

/**
 * Returns the rendered compose YAML for the requested profile.
 * For 'hs', digest substitutions are already applied (resolved at build time).
 * For 'dev', the YAML is returned verbatim (uses local `toon:*` image tags).
 * Throws `ComposeLoaderError` if the requested profile's YAML is unreadable.
 */
export function loadComposeTemplate(
  profile: ComposeProfile,
  options: ComposeLoaderOptions = {}
): string {
  const distDir = options.distDir ?? defaultDistDir();
  const composePath = join(distDir, 'compose', `townhouse-${profile}.yml`);
  if (!existsSync(composePath)) {
    throw new ComposeLoaderError(
      `compose template not found: ${composePath}. ` +
      `Did you run 'pnpm --filter @toon-protocol/townhouse build' first?`
    );
  }
  return readFileSync(composePath, 'utf-8');
}

/**
 * Writes the resolved compose YAML to `<townhouseHome>/compose/<profile>.yml`
 * and copies `dist/image-manifest.json` to `<townhouseHome>/image-manifest.json`.
 * BOTH output files are written with mode 0o600 (NFR8 — operator-secret file mode).
 * Returns the absolute paths of the two files written.
 */
export function materializeComposeTemplate(
  profile: ComposeProfile,
  options: ComposeLoaderOptions = {}
): { composePath: string; manifestPath: string } {
  const home = options.townhouseHome ?? join(homedir(), '.townhouse');
  const composeDir = join(home, 'compose');

  mkdirSync(composeDir, { recursive: true });
  // chmod after mkdir for already-existing dirs (mkdir's mode arg is only
  // honored on creation). Defensive re-chmod enforces 0o700 on every call.
  chmodSync(home, 0o700);
  chmodSync(composeDir, 0o700);

  const yaml = loadComposeTemplate(profile, options);
  const composePath = join(composeDir, `townhouse-${profile}.yml`);
  writeFileSync(composePath, yaml, { mode: 0o600, encoding: 'utf-8' });
  // Defensive re-chmod: writeFileSync's mode option is masked by process.umask()
  // on some Linux filesystems (notably WSL2). chmodSync is the load-bearing call.
  chmodSync(composePath, 0o600);

  const distDir = options.distDir ?? defaultDistDir();
  const manifestSrc = join(distDir, 'image-manifest.json');
  const manifestPath = join(home, 'image-manifest.json');

  if (existsSync(manifestSrc)) {
    const manifest = readFileSync(manifestSrc, 'utf-8');
    writeFileSync(manifestPath, manifest, { mode: 0o600, encoding: 'utf-8' });
    chmodSync(manifestPath, 0o600);
  } else {
    // Manifest is required for HS mode — fail loudly. Dev mode tolerates absence.
    if (profile === 'hs') {
      throw new ComposeLoaderError(
        `image-manifest.json not found at ${manifestSrc}. ` +
        `HS mode requires a digest-pinned image manifest. ` +
        `Reinstall @toon-protocol/townhouse from npm to restore the manifest.`
      );
    }
  }

  return { composePath, manifestPath };
}
