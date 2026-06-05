# btp-bypass — local-e2e SOCKS5 short-circuit (NOT for production)

A tiny SOCKS5 proxy used **only** by the local-HS E2E loop
(`scripts/townhouse-e2e-local-hs.sh up --local`) to replace the unreliable
public ATOR `.anon` egress on a developer/CI host.

## What it does

`proxy.mjs` is a ~30-line SOCKS5 server that pipes **every** CONNECT to one fixed
upstream (`UPSTREAM_HOST:UPSTREAM_PORT`, default `connector:3000`), ignoring the
destination the client requested (the apex `.anon` hostname).

The toon-client speaks unmodified `socks5h://` and still dials the apex `.anon`
host; the proxy short-circuits that CONNECT straight to the apex connector's BTP
port on the shared Docker network. The client **image and its production
transport path are unchanged** — production still takes the real ATOR `.anon`
route whenever `ANYONE_PROXY_URLS` is unset or points at a real ATOR proxy.

## Why it is gated to `--local`

`docker/src/entrypoint-toon-client.ts` has no native direct-BTP mode: with
`ANYONE_PROXY_URLS` set it dials the apex `.anon` host through that SOCKS5h
proxy. On a local host the public ATOR network is flaky, so the local-e2e
harness substitutes this proxy by setting
`ANYONE_PROXY_URLS=socks5h://btp-bypass:1080` **only** in the `--local` path. In
every other mode (default `up`, real Akash deploys) the client uses the public
ATOR proxies / local anon daemon exactly as before.

## Wiring

The harness (`scripts/townhouse-e2e-local-hs.sh`) runs this as the `btp-bypass`
container (image `node:20-alpine`, `proxy.mjs` bind-mounted) dual-homed on the
apex's `townhouse-hs-net`, then points the local client at it. See
`start_btp_bypass()` in that script.

## Env

| Var             | Default     | Meaning                         |
| --------------- | ----------- | ------------------------------- |
| `UPSTREAM_HOST` | `connector` | apex connector BTP service name |
| `UPSTREAM_PORT` | `3000`      | apex connector BTP port         |
| `LISTEN_PORT`   | `1080`      | SOCKS5 listen port              |
