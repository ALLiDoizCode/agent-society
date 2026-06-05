// ─────────────────────────────────────────────────────────────────────────────
// BTP-bypass SOCKS5 proxy — LOCAL-E2E ONLY (never used in production)
// ─────────────────────────────────────────────────────────────────────────────
//
// A ~30-line SOCKS5 server that pipes EVERY CONNECT to a single fixed upstream
// (UPSTREAM_HOST:UPSTREAM_PORT, default connector:3000), IGNORING the requested
// destination host (e.g. the apex `.anon` hostname the toon-client asks for).
//
// WHY THIS EXISTS (and why it is gated to the local-e2e `--local` path only):
//   The toon-client entrypoint (docker/src/entrypoint-toon-client.ts) has NO
//   native direct-BTP mode — when `ANYONE_PROXY_URLS` is set it dials the apex's
//   `.anon` hostname through that SOCKS5h proxy (socks5h => the PROXY resolves the
//   hostname). In production that proxy is a real ATOR egress that resolves the
//   `.anon` onion and tunnels to the apex hidden service. On a local dev host the
//   public ATOR network is unreliable, so for the local-e2e loop we substitute
//   THIS proxy: the client still speaks unmodified socks5h and still asks for the
//   apex `.anon` host, but every CONNECT is short-circuited straight to the
//   apex connector's BTP port on the shared Docker network.
//
// This changes NOTHING about the client image or the production transport path
// (real ATOR `.anon` via SOCKS5h, taken whenever ANYONE_PROXY_URLS is unset or
// points at a real ATOR proxy). It is wired in ONLY by
// scripts/townhouse-e2e-local-hs.sh in `--local` mode.
//
// Env:
//   UPSTREAM_HOST  (default 'connector')  — apex connector BTP service name
//   UPSTREAM_PORT  (default 3000)         — apex connector BTP port
//   LISTEN_PORT    (default 1080)         — SOCKS5 listen port
import net from 'node:net';

const UP_HOST = process.env.UPSTREAM_HOST || 'connector';
const UP_PORT = parseInt(process.env.UPSTREAM_PORT || '3000', 10);
const LISTEN = parseInt(process.env.LISTEN_PORT || '1080', 10);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const server = net.createServer((cli) => {
  // SOCKS5 greeting: [ver, nMethods, ...methods]. Reply "no auth".
  cli.once('data', (g) => {
    if (g[0] !== 0x05) {
      cli.end();
      return;
    }
    cli.write(Buffer.from([0x05, 0x00]));
    // SOCKS5 request: [ver, cmd, rsv, atyp, addr..., port]. cmd 0x01 = CONNECT.
    cli.once('data', (req) => {
      if (req[0] !== 0x05 || req[1] !== 0x01) {
        cli.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        cli.end();
        return;
      }
      // Parse the requested host purely for logging — we override it anyway.
      let host = '(unknown)';
      const atyp = req[3];
      try {
        if (atyp === 0x03) {
          const l = req[4];
          host = req.slice(5, 5 + l).toString();
        } else if (atyp === 0x01) {
          host = req.slice(4, 8).join('.');
        }
      } catch {
        /* ignore malformed addr — upstream is fixed regardless */
      }
      log(`CONNECT requested=${host} -> forcing ${UP_HOST}:${UP_PORT}`);
      const up = net.connect(UP_PORT, UP_HOST, () => {
        // SOCKS5 success reply, then bidirectional pipe.
        cli.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        up.pipe(cli);
        cli.pipe(up);
      });
      up.on('error', (e) => {
        log('upstream error', e.message);
        try {
          cli.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        } catch {
          /* client already gone */
        }
        cli.end();
      });
      cli.on('error', () => up.destroy());
    });
  });
  cli.on('error', () => {});
});

server.listen(LISTEN, '0.0.0.0', () =>
  log(`SOCKS5 fixed-upstream proxy on :${LISTEN} -> ${UP_HOST}:${UP_PORT}`)
);
