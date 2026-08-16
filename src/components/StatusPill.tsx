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
        tone === 'blocked' && 'status-pill-blocked border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        tone === 'skipped' && 'status-pill-skipped border-slate-400/35 bg-slate-400/10 text-slate-700 dark:text-slate-300',
        tone === 'cancelled' && 'status-pill-cancelled border-slate-400/35 bg-slate-400/10 text-slate-700 dark:text-slate-300',
        tone === 'error' && 'status-pill-error border-destructive/35 bg-destructive/10 text-destructive',
      )}
      variant="outline"
    >
      {t(`common.status.${tone}`)}
    </Badge>
  );
}
