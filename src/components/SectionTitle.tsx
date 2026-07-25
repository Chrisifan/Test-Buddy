import type { ReactNode } from 'react';

export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/90">{eyebrow}</p>
        <div className="space-y-1">
          <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}
