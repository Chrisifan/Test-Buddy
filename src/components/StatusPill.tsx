import type { RunTone } from '../../shared/studio.js';

import { RunState } from './RunState.js';

export function StatusPill({ tone }: { tone: RunTone }) {
  return <RunState tone={tone} />;
}
