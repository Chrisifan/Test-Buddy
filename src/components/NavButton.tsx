import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';

export const NavButton = ({
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
}) => {
  return (
    <Button
      aria-label={label}
      className={cn(
        'nav-button relative w-full cursor-pointer justify-start overflow-hidden transition duration-200',
        showLabel ? 'h-9 px-2.5' : 'h-8 w-8 rounded-[4px] px-0',
        active
          ? 'is-active rounded-l-[8px] rounded-r-none bg-primary/10 text-primary shadow-none'
          : 'rounded-[6px] bg-transparent text-muted-foreground shadow-none hover:bg-muted hover:text-foreground',
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
};
