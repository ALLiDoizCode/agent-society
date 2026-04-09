/**
 * Example 04: Subscribe to Events (Read-Side)
 *
 * Connects to a TOON peer's relay and subscribes to kind:1 events.
 * Reading is free — no payment needed for subscriptions.
 *
 * Events arrive in TOON format (compact binary) and are decoded
 * to standard Nostr JSON events for display.
 *
 * Prerequisites:
 *   ./scripts/sdk-e2e-infra.sh up
 *
 * Run:
 *   cd examples/client-example && pnpm run example:04
 *
 * Stop with Ctrl+C.
 */

import WebSocket from 'ws';
import { decodeEventFromToon } from '@toon-protocol/relay';

const PEER1_RELAY = 'ws://localhost:19700';

function main() {
  console.log('\n--- TOON Event Subscriber ---\n');
  console.log(`Connecting to ${PEER1_RELAY}...`);

  const ws = new WebSocket(PEER1_RELAY);
  const subId = `sub-${Date.now()}`;
  let eventCount = 0;

  ws.on('open', () => {
    console.log('Connected! Subscribing to kind:1 events...\n');
    // NIP-01 subscription: all kind:1 events
    ws.send(JSON.stringify(['REQ', subId, { kinds: [1], limit: 50 }]));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg)) return;

      if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
        eventCount++;
        // TOON relay returns events in TOON format (compact binary as string)
        try {
          const toonBytes = new TextEncoder().encode(msg[2]);
          const event = decodeEventFromToon(toonBytes);
          const e = event as Record<string, unknown>;
          const pubkey = String(e['pubkey'] ?? '').slice(0, 16);
          const content = String(e['content'] ?? '').slice(0, 80);
          const createdAt = e['created_at'] ? new Date(Number(e['created_at']) * 1000).toISOString() : 'unknown';
          console.log(`[${eventCount}] ${createdAt} | ${pubkey}... | ${content}`);
        } catch {
          // If TOON decode fails, try as raw JSON
          const e = msg[2] as Record<string, unknown>;
          console.log(`[${eventCount}] pubkey=${String(e['pubkey'] ?? '').slice(0, 16)}... content=${String(e['content'] ?? '').slice(0, 80)}`);
        }
      } else if (msg[0] === 'EOSE') {
        console.log(`\n--- End of stored events (${eventCount} total) ---`);
        console.log('Listening for new events... (Ctrl+C to stop)\n');
      }
    } catch {
      // ignore parse errors
    }
  });

  ws.on('error', (err: Error) => {
    console.error(`WebSocket error: ${err.message}`);
    console.error('Is the infrastructure running? ./scripts/sdk-e2e-infra.sh up');
  });

  ws.on('close', () => {
    console.log('\nDisconnected from relay.');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    ws.send(JSON.stringify(['CLOSE', subId]));
    ws.close();
    process.exit(0);
  });
}

main();
