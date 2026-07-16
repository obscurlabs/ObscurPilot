import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      primary: 'ui-button-primary',
      secondary: 'ui-button-secondary',
      ghost: 'ui-button-ghost',
      danger: 'ui-button-danger',
    },
    size: {
      default: 'ui-button-default',
      compact: 'ui-button-compact',
    },
  },
  defaultVariants: { variant: 'secondary', size: 'default' },
});

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...properties
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      type={type}
      {...properties}
    />
  );
}
