import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps): React.JSX.Element {
  return <TabsPrimitive.List className={cn('inline-flex items-center gap-1 rounded-md bg-muted p-1', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps): React.JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'focus-ring rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors data-[state=active]:bg-surface-raised data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps): React.JSX.Element {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />;
}
