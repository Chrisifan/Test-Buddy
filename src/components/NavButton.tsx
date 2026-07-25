import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';

export function NavButton({
  active,
  icon,
  label,
  showLabel = true,
  onClick,
}: {
  active: boolean;
  icon?: ReactNode;
  label: string;
  showLabel?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className={cn(
        'nav-button relative w-full cursor-pointer justify-start overflow-hidden transition duration-200',
        showLabel ? 'h-10 rounded-[4px] px-3' : 'h-9 w-9 rounded-[4px] px-0',
        active
          ? 'is-active bg-primary/12 text-primary shadow-none'
          : 'bg-transparent text-muted-foreground shadow-none hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
      title={label}
      type="button"
      variant="ghost"
    >
      <span className="shrink-0">{icon}</span>
      {showLabel ? <span className="truncate text-sm font-medium">{label}</span> : <span className="sr-only">{label}</span>}
    </Button>
  );
}
