import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...properties }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-2xl border border-white/8 bg-zinc-900/60', className)}
      {...properties}
    />
  );
}

export function CardHeader({ className, ...properties }: ComponentProps<'header'>) {
  return <header className={cn('px-6 pt-6', className)} {...properties} />;
}

export function CardContent({ className, ...properties }: ComponentProps<'div'>) {
  return <div className={cn('p-6', className)} {...properties} />;
}
