import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex min-h-5 items-center rounded-[var(--control-radius)] px-1.5 py-0.5 text-[length:var(--font-size-meta)] font-medium leading-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-none',
        secondary: 'bg-secondary text-secondary-foreground shadow-none',
        outline: 'border-0 bg-[var(--surface-container-low)] text-muted-foreground shadow-none',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} data-slot="badge" {...props} />;
}

export { Badge, badgeVariants };
