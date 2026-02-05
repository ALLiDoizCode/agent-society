/**
 * Nostr Event Kinds for Agent Society Protocol
 *
 * These event kinds are proposed for ILP/Nostr integration.
 * Range 10000-19999 is for replaceable events.
 * Range 20000-29999 is for ephemeral events.
 */

/**
 * ILP Peer Info (Replaceable)
 *
 * Published by connectors to advertise their ILP peering information.
 * Other agents can discover peers by querying for this kind from their follows.
 *
 * Tags:
 *   ["ilp", "<ilp_address>"] - ILP address prefix (e.g., "g.agent.alice")
 *   ["btp", "<endpoint>"] - BTP WebSocket endpoint (e.g., "wss://alice.example/btp")
 *   ["asset", "<code>", "<scale>"] - Supported asset (e.g., ["asset", "USD", "2"])
 *   ["settlement", "<type>", "<details>..."] - Settlement method
 *   ["relay", "<wss://...>"] - Preferred relays for this peer
 */
export const ILP_PEER_INFO_KIND = 10032;

/**
 * SPSP Info (Replaceable)
 *
 * Published by receivers to advertise static SPSP parameters.
 * Use for long-lived payment endpoints where fresh secrets aren't required.
 *
 * Tags:
 *   ["destination", "<ilp_address>"] - ILP destination account
 *   ["secret", "<base64>"] - Shared secret for STREAM
 *   ["receipts", "true"|"false"] - Whether receipts are enabled
 */
export const SPSP_INFO_KIND = 10047;

/**
 * SPSP Request (Ephemeral, NIP-47 style)
 *
 * Sent by payers to request fresh SPSP parameters from a receiver.
 * Content is NIP-44 encrypted JSON.
 *
 * Encrypted content:
 * {
 *   "method": "spsp_setup",
 *   "params": {
 *     "receipt_nonce"?: "<base64>",
 *     "receipt_secret"?: "<base64>"
 *   }
 * }
 */
export const SPSP_REQUEST_KIND = 23194;

/**
 * SPSP Response (Ephemeral, NIP-47 style)
 *
 * Sent by receivers in response to SPSP requests.
 * Content is NIP-44 encrypted JSON.
 *
 * Encrypted content:
 * {
 *   "result_type": "spsp_setup",
 *   "result": {
 *     "destination_account": "<ilp_address>",
 *     "shared_secret": "<base64>",
 *     "receipts_enabled": boolean
 *   }
 * }
 *
 * Or on error:
 * {
 *   "result_type": "spsp_setup",
 *   "error": {
 *     "code": "<error_code>",
 *     "message": "<human_readable>"
 *   }
 * }
 */
export const SPSP_RESPONSE_KIND = 23195;

/**
 * Standard Nostr event kinds we use
 */
export const FOLLOW_LIST_KIND = 3; // NIP-02
export const METADATA_KIND = 0; // NIP-01
