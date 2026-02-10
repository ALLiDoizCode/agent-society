# 9. Source Tree

```
agent-society/
├── packages/
│   ├── core/                           # @agent-society/core
│   │   ├── src/
│   │   │   ├── index.ts               # Package exports
│   │   │   ├── constants.ts           # Event kind constants
│   │   │   ├── types.ts               # TypeScript interfaces
│   │   │   ├── discovery/
│   │   │   │   ├── index.ts
│   │   │   │   ├── NostrPeerDiscovery.ts
│   │   │   │   └── NostrPeerDiscovery.test.ts
│   │   │   ├── spsp/
│   │   │   │   ├── index.ts
│   │   │   │   ├── NostrSpspClient.ts
│   │   │   │   ├── NostrSpspClient.test.ts
│   │   │   │   ├── NostrSpspServer.ts
│   │   │   │   └── NostrSpspServer.test.ts
│   │   │   ├── trust/
│   │   │   │   ├── index.ts
│   │   │   │   ├── SocialTrustManager.ts
│   │   │   │   ├── SocialTrustManager.test.ts
│   │   │   │   └── creditLimit.ts
│   │   │   └── events/
│   │   │       ├── index.ts
│   │   │       ├── parsers.ts
│   │   │       ├── parsers.test.ts
│   │   │       ├── builders.ts
│   │   │       └── builders.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── relay/                          # @agent-society/relay
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── server.ts              # Main relay entry point
│   │   │   ├── websocket/
│   │   │   │   ├── index.ts
│   │   │   │   ├── WebSocketServer.ts
│   │   │   │   └── WebSocketServer.test.ts
│   │   │   ├── bls/
│   │   │   │   ├── index.ts
│   │   │   │   ├── BusinessLogicServer.ts
│   │   │   │   └── BusinessLogicServer.test.ts
│   │   │   ├── pricing/
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts                # PricingConfig, PricingError
│   │   │   │   ├── PricingService.ts
│   │   │   │   ├── PricingService.test.ts
│   │   │   │   ├── config.ts               # Env/file config loading
│   │   │   │   └── config.test.ts
│   │   │   ├── storage/
│   │   │   │   ├── index.ts
│   │   │   │   ├── EventStore.ts
│   │   │   │   └── EventStore.test.ts
│   │   │   └── toon/
│   │   │       ├── index.ts
│   │   │       ├── encoder.ts
│   │   │       ├── decoder.ts
│   │   │       └── toon.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── examples/                       # @agent-society/examples
│       ├── src/
│       │   ├── peer-discovery-demo.ts
│       │   ├── spsp-handshake-demo.ts
│       │   └── ilp-gated-relay-demo/
│       │       ├── README.md
│       │       ├── agent.ts
│       │       ├── relay.ts
│       │       └── mock-connector.ts
│       ├── package.json
│       └── tsconfig.json
│
├── docker/                              # Docker entrypoint (BLS + relay + bootstrap)
│   ├── src/
│   │   ├── entrypoint.ts             # Main entrypoint: config, BLS server, SPSP server, bootstrap
│   │   └── entrypoint.test.ts        # Unit tests for entrypoint
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── docs/
│   ├── architecture.md                 # This document
│   ├── prd.md                         # Product requirements
│   ├── brief.md                       # Project brief
│   └── ...                            # Other documentation
│
├── .github/
│   └── workflows/
│       └── ci.yml                     # CI pipeline
│
├── package.json                        # Root package.json (workspaces)
├── pnpm-workspace.yaml                # pnpm workspace config
├── tsconfig.json                      # Root TypeScript config
├── vitest.config.ts                   # Vitest configuration
├── eslint.config.js                   # ESLint configuration
├── prettier.config.js                 # Prettier configuration
└── README.md                          # Project README
```

---
