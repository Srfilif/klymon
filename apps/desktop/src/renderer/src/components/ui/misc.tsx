import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Progress({ value, className }: { value: number; className?: string }): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Alert({
  variant = 'info',
  title,
  children,
  className,
}: {
  variant?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  const styles = {
    info: 'border-primary/25 bg-primary/10 text-primary',
    warning: 'border-warning/25 bg-warning/10 text-warning',
    error: 'border-destructive/25 bg-destructive/10 text-destructive',
    success: 'border-success/25 bg-success/10 text-success',
  } as const;
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-xs', styles[variant], className)}>
      {variant === 'info' ? <Info className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
      <div className="text-foreground/90">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {title ? <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-raised/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ScrollArea({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('overflow-y-auto', className)} {...props} />;
}
