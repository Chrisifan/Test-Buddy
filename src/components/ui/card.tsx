import type * as React from 'react';

import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'tech-panel rounded-[8px] text-card-foreground',
        className,
      )}
      data-slot="card"
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col space-y-1 p-[var(--density-panel-padding)]', className)}
      data-slot="card-header"
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('font-semibold leading-none tracking-tight', className)}
      data-slot="card-title"
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('text-[length:var(--font-size-control)] text-muted-foreground', className)}
      data-slot="card-description"
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-[var(--density-panel-padding)] pt-0', className)} data-slot="card-content" {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center p-[var(--density-panel-padding)] pt-0', className)}
      data-slot="card-footer"
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
