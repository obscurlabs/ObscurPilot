import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Skeleton({ className, ...properties }: ComponentProps<'div'>) {
  return <div className={cn('ui-skeleton', className)} aria-hidden="true" {...properties} />;
}
