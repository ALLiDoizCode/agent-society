import { defineConfig } from 'tsup';

export default defineConfig({
  // Three entry points: the library surface (index), and the two bins
  // (`toon-clientd` daemon, `toon-mcp` stdio server). The bin sources carry a
  // `#!/usr/bin/env node` shebang which tsup preserves in the emitted files.
  entry: ['src/index.ts', 'src/daemon.ts', 'src/mcp.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // socks-proxy-agent is an OPTIONAL dependency (only needed when reads route
  // through an `.anyone` hidden-service relay). Keep its dynamic `import()`
  // external so the bundle still loads when it is not installed.
  external: ['socks-proxy-agent'],
});
