import { defineConfig } from 'tsup';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
  onSuccess: async () => {
    const composeDistDir = 'dist/compose';
    await mkdir(composeDistDir, { recursive: true });

    // Copy dev template verbatim (no digest substitution — uses local toon:* tags).
    await cp('compose/townhouse-dev.yml', join(composeDistDir, 'townhouse-dev.yml'));

    // Render HS template — substitute digest placeholders from image-manifest.json
    // if present. When absent (typical local dev), emit a warning and ship the
    // unsubstituted template. CI calls scripts/render-compose-template.mjs AFTER
    // download-artifact places the manifest, so the authoritative substitution
    // happens there (not here). This path is belt-and-suspenders for local builds
    // where the developer has manually placed the manifest.
    const manifestPath = 'dist/image-manifest.json';
    const hsTemplateRaw = await readFile('compose/townhouse-hs.yml', 'utf-8');
    let hsRendered = hsTemplateRaw;

    try {
      await access(manifestPath);
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw) as {
        images: Record<string, { name: string; tag: string; digest: string }>;
      };

      const subs: Array<[string, string]> = [
        ['${TOON_TOWNHOUSE_API_DIGEST}', `@${manifest.images['townhouse-api'].digest}`],
        ['${TOON_TOWN_DIGEST}',          `@${manifest.images.town.digest}`],
        ['${TOON_MILL_DIGEST}',          `@${manifest.images.mill.digest}`],
        ['${TOON_DVM_DIGEST}',           `@${manifest.images.dvm.digest}`],
        ['${TOON_CONNECTOR_DIGEST}',     `@${manifest.images.connector.digest}`],
      ];

      for (const [placeholder, replacement] of subs) {
        hsRendered = hsRendered.replaceAll(placeholder, replacement);
      }
    } catch {
      // Manifest absent — ship the unsubstituted template. This is the normal
      // local-dev path. The CI tarball-content verification step catches
      // unsubstituted placeholders before pnpm publish runs.
      console.warn(
        '[tsup] dist/image-manifest.json not found — shipping unsubstituted ' +
        'townhouse-hs.yml. This is fine for local dev but invalid for npm publish.'
      );
    }

    await writeFile(join(composeDistDir, 'townhouse-hs.yml'), hsRendered, 'utf-8');
  },
});
