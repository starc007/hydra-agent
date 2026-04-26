import * as React from 'react';
import { cn } from '../../lib/cn';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('bg-surface border border-border rounded-xl', className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-between px-5 pt-5 pb-3', className)} {...props} />
);
CardHeader.displayName = 'CardHeader';

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pb-5', className)} {...props} />
);
CardContent.displayName = 'CardContent';

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-[11px] uppercase tracking-[0.08em] text-muted font-medium', className)} {...props} />
);
CardTitle.displayName = 'CardTitle';
