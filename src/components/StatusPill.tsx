import type { RunTone } from '../../shared/studio.js';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '../i18n/index.js';

export function StatusPill({ tone }: { tone: RunTone }) {
  const { t } = useI18n();

  return (
    <Badge
      className={cn(
        'status-pill rounded-[var(--control-radius)] px-1.5 py-0.5 text-[length:var(--font-size-meta)] font-medium normal-case tracking-normal',
        tone === 'passed' && 'status-pill-passed',
        tone === 'running' && 'status-pill-running',
        tone === 'failed' && 'status-pill-failed',
        tone === 'neutral' && 'status-pill-neutral',
      )}
      variant="outline"
    >
      {t(`common.status.${tone}`)}
    </Badge>
  );
}
