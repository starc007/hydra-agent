import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
  {
    variants: {
      tone: {
        default: 'bg-elevated text-muted border-border',
        brand: 'bg-brand-soft text-brand border-brand-ring/40',
        accent: 'bg-accent/15 text-accent border-accent/20',
        warn: 'bg-warn/15 text-warn border-warn/20',
        err: 'bg-err/15 text-err border-err/20',
        muted: 'bg-elevated text-subtle border-border',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}
