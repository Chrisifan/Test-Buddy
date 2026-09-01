import type { RunTone } from '../../shared/studio.js';

import { RunState } from './RunState.js';

export const StatusPill = ({ tone }: { tone: RunTone }) => {
  return <RunState tone={tone} />;
};
