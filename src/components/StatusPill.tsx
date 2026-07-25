import type { RunTone } from '../../shared/studio.js';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '../i18n/index.js';

export function StatusPill({ tone }: { tone: RunTone }) {
  const { t } = useI18n();

  return (
    <Badge
      className={cn(
        'rounded-[4px] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]',
        tone === 'passed' && 'bg-primary/12 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_32%,transparent),0_0_18px_color-mix(in_oklch,var(--primary)_16%,transparent)]',
        tone === 'running' && 'bg-accent text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_20%,transparent)]',
        tone === 'failed' && 'bg-destructive/12 text-destructive shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--destructive)_26%,transparent)]',
        tone === 'neutral' && 'bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--border)_36%,transparent)]',
      )}
      variant="outline"
    >
      {t(`common.status.${tone}`)}
    </Badge>
  );
}
