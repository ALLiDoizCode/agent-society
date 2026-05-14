import React from 'react';
import { Box, Text } from 'ink';
import { useEarnings } from './use-earnings.js';
import { HeroBand } from './components/HeroBand.js';
import { Banner } from './components/Banner.js';
import { ApexStripSlot } from './components/ApexStripSlot.js';
import { PeerTableSlot } from './components/PeerTableSlot.js';
import { FooterSlot } from './components/FooterSlot.js';
import { COPY } from './copy.js';

export interface AppProps {
  apiUrl?: string;
  refreshIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

export default function App(props: AppProps): React.ReactElement {
  const state = useEarnings(props);

  if (state.phase === 'loading') {
    return <Text>{COPY.loading}</Text>;
  }

  const { data } = state;
  const bannerKey = state.phase === 'stale' ? state.bannerKey : null;

  return (
    <Box flexDirection="column">
      <HeroBand
        apex={data.apex}
        peers={data.peers}
        eventsRelayed={data.eventsRelayed}
      />
      <Banner bannerKey={bannerKey} />
      <ApexStripSlot apex={data.apex} peers={data.peers} />
      <PeerTableSlot peers={data.peers} />
      <FooterSlot />
    </Box>
  );
}
