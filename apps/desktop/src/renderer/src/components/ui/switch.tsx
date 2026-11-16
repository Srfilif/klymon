import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

export function Switch({ className, ...props }: SwitchPrimitive.SwitchProps): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'focus-ring peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4.5" />
    </SwitchPrimitive.Root>
  );
}
