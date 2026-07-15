import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-white/10 bg-white/5 text-zinc-300',
        ready: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
        waiting: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
        accent: 'border-violet-400/20 bg-violet-400/10 text-violet-200',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...properties
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...properties} />;
}
