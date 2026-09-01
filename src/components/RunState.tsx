import type { ComponentType } from 'react';
import type { RunTone } from '../../shared/studio.js';

import { Ban, CircleAlert, CircleCheck, CircleDashed, CircleX, LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useI18n } from '../i18n/index.js';

type RunStateIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

const stateIcons: Record<RunTone, RunStateIcon> = {
  passed: CircleCheck,
  running: LoaderCircle,
  failed: CircleX,
  blocked: CircleAlert,
  skipped: CircleDashed,
  cancelled: Ban,
  error: CircleX,
  neutral: CircleDashed,
};

export function RunState({ tone, className }: { tone: RunTone; className?: string }) {
  const { t } = useI18n();
  const Icon = stateIcons[tone];

  return (
    <span
      aria-label={t(`common.status.${tone}`)}
      className={cn(
        'status-pill inline-flex items-center gap-1 rounded-[var(--control-radius)] px-1.5 py-0.5 text-[length:var(--font-size-meta)] font-medium normal-case tracking-normal',
        `status-pill-${tone}`,
        tone === 'running' && 'status-pill-running',
        className,
      )}
      data-run-state={tone}
      role="status"
    >
      <Icon aria-hidden className={cn('h-3 w-3 shrink-0', tone === 'running' && 'animate-spin')} />
      <span>{t(`common.status.${tone}`)}</span>
    </span>
  );
}
