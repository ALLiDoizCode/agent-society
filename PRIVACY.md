# Privacy Policy

_Last updated: 2026-06-14_

This policy covers the **TOON Protocol** open-source software, in particular the
**`toon` Claude Code plugin** and the **`@toon-protocol/client-mcp`** package it
uses (the `toon-clientd` daemon and `toon-mcp` MCP server). It explains what data
the software touches and what it does **not** do.

## Summary

- **We collect nothing.** The software sends **no telemetry, analytics, or usage
  data** to the TOON Protocol authors or any of their servers. The authors do not
  operate a backend that receives your data.
- **Your keys stay on your machine.** Private keys never leave your device and are
  never sent to Claude, to the plugin, or to us.
- **Network traffic goes only where you point it** — the TOON relay/connector and
  blockchain endpoints **you** configure.

## What the software stores locally

The `toon-clientd` daemon stores configuration and signing material **only on your
own computer**, by default under `~/.toon-client/`:

- Your BIP-39 mnemonic or an **encrypted keystore** (scrypt + AES-256-GCM, file
  mode `0600`) and the derived chain identities.
- Payment-channel state (nonce watermark, cumulative amounts) and a local cache of
  events read from relays.

This data is never transmitted to us. Private keys are never exposed to the Claude
agent — it sees only public addresses and operation results.

## What is transmitted, and to whom

Network activity happens **only as a result of actions you (or your agent) take**,
and only to endpoints **you configure**:

- **TOON relay / connector (apex):** when you publish, read, open a channel, or
  swap, the daemon sends your signed Nostr events and off-chain payment-channel
  claims over BTP/ILP to the relay you configured. **Nostr events you publish are
  public by design** and are stored/served by that relay.
- **Blockchain RPC / GraphQL endpoints:** when opening or settling a payment
  channel, the daemon talks to the chain RPC/GraphQL URLs you configure (EVM,
  Solana, Mina).
- **npm registry:** installing the plugin (`npx @toon-protocol/client-mcp`)
  downloads the package from npm.

These third parties (relay operators, RPC providers, npm) have their own privacy
practices, which the TOON Protocol authors do not control.

## What we do NOT do

- No telemetry, no analytics, no crash reporting to us.
- No cookies, no tracking, no advertising.
- No selling or sharing of data — we never receive any to begin with.

## Children's privacy

The software is a developer tool not directed at children and collects no personal
information.

## Changes to this policy

Updates are published in this file in the public repository; the "Last updated"
date reflects the latest revision.

## Contact

Questions or concerns: open an issue at
<https://github.com/toon-protocol/town/issues>.

> Provided as-is for the open-source software described above. It is not legal
> advice; operators who run TOON infrastructure as a hosted service for others
> are responsible for their own privacy disclosures.
