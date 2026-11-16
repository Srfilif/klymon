import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', {
  variants: {
    variant: {
      default: 'border-primary/30 bg-primary/15 text-primary',
      muted: 'border-border bg-muted text-muted-foreground',
      success: 'border-success/30 bg-success/15 text-success',
      warning: 'border-warning/30 bg-warning/15 text-warning',
      destructive: 'border-destructive/30 bg-destructive/15 text-destructive',
      outline: 'border-border text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
