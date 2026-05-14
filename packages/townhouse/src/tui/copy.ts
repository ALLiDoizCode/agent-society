export const COPY = {
  heroEarly: `you're early`,
  heroEarlyRotation: [`you're early`, `warming up`, `first packet en route`] as const,
  loading: `Fetching earnings…`,
  qualifierPrefix: `MONTH $0.00`,
  qualifierEventsWords: `events relayed`,
  qualifierEvents: (n: number) => `${n} events relayed`,
  banners: {
    connectorUnavailable: `Connector not reachable — showing last known values. Retrying in 2s.`,
    fetchFailed: `Last refresh failed — retrying.`,
  },
  future: {
    apexRoutingEmpty: `(enable mill to route)`,
    peerTableEmpty: `no peers yet — run 'townhouse node add town'`,
    recentClaimsEmpty: `no settlements yet — press [a] when activity arrives`,
  },
} as const;
