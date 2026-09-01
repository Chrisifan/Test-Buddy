import type * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = ({ className, ...props }: React.ComponentProps<'textarea'>) => {
  return (
    <textarea
      className={cn(
        'flex min-h-14 w-full rounded-[4px] border border-input bg-card px-2.5 py-1.5 text-[length:var(--font-size-control)] shadow-none transition-[color,box-shadow,border-color,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
};

export { Textarea };
