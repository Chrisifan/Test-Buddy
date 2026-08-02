import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] text-[length:var(--font-size-control)] font-semibold transition-[color,box-shadow,background-color,border-color,transform] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-3.5 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:translate-y-px',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-sm hover:bg-destructive/90',
        outline:
          'border border-border bg-card text-foreground shadow-sm hover:bg-accent hover:text-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/85',
        ghost: 'text-muted-foreground shadow-none hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[var(--density-control-height)] px-3 py-1',
        sm: 'h-[var(--density-control-height-sm)] rounded-[4px] px-2 text-[length:var(--font-size-meta)]',
        lg: 'h-[var(--density-control-height-lg)] rounded-[4px] px-4',
        icon: 'size-[var(--density-control-icon)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button"
      {...props}
    />
  );
}

export { Button, buttonVariants };
