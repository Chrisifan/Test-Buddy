import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'primary' | 'passed' | 'failed' | 'running';

function toneClass(tone: Tone): string {
  if (tone === 'primary') {
    return 'tech-active text-primary';
  }

  if (tone === 'passed') {
    return 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200';
  }

  if (tone === 'failed') {
    return 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200';
  }

  if (tone === 'running') {
    return 'border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200';
  }

  return 'tech-subtle text-foreground';
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  meta,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="page-header motion-page-header flex min-h-[92px] flex-wrap items-start justify-between gap-3 pb-4">
      <div className="min-w-0 max-w-4xl">
        <p className="font-mono text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-[28px] font-bold leading-9 tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap gap-2">{meta}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function PageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('motion-page-shell grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]', className)}>{children}</div>;
}

export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('motion-page-body min-h-0 overflow-y-auto pt-4 pb-6', className)}>{children}</div>;
}

export function Surface({
  children,
  className,
  variant = 'panel',
  ...props
}: {
  children: ReactNode;
  className?: string;
  variant?: 'panel' | 'subtle' | 'active' | 'evidence' | 'plain' | 'stat';
} & ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={cn(
        'motion-surface relative overflow-hidden',
        variant === 'panel' && 'rounded-[8px] tech-panel',
        variant === 'subtle' && 'rounded-[6px] tech-subtle',
        variant === 'active' && 'tech-active text-foreground',
        variant === 'evidence' && 'rounded-[8px] tech-evidence',
        variant === 'plain' && 'tech-plain rounded-[6px]',
        variant === 'stat' && 'rounded-[8px] tech-stat',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function MetricTile({
  label,
  value,
  description,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  description?: string;
  tone?: Tone;
}) {
  return (
    <div className={cn('metric-tile motion-surface rounded-[6px] p-3.5', toneClass(tone))}>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 truncate text-[24px] font-bold tracking-[-0.03em] text-foreground">{value}</p>
      {description ? <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function ActionListItem({
  title,
  description,
  meta,
  active = false,
  onClick,
}: {
  title: string;
  description: string;
  meta?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : null}
    </div>
  );

  if (onClick) {
    return (
      <button
        className={cn(
          'motion-row w-full cursor-pointer rounded-[4px] p-3 text-left transition duration-200',
          active ? 'tech-active' : 'tech-list-row hover:bg-accent/72',
        )}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'motion-row w-full rounded-[4px] p-3 text-left transition duration-200',
        active ? 'tech-active' : 'tech-list-row hover:bg-accent/72',
      )}
    >
      {content}
    </div>
  );
}

export function EvidenceCard({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Surface className="p-4" variant="evidence">
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
    </Surface>
  );
}
