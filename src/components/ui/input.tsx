import type * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-[var(--density-control-height)] w-full rounded-[4px] border border-input bg-card px-2.5 py-1 text-[length:var(--font-size-control)] shadow-none transition-[color,box-shadow,border-color,background-color] outline-none file:border-0 file:bg-transparent file:text-[length:var(--font-size-control)] file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
