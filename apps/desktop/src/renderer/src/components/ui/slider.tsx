import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '../../lib/utils';

export function Slider({ className, ...props }: SliderPrimitive.SliderProps): React.JSX.Element {
  return (
    <SliderPrimitive.Root className={cn('relative flex w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="focus-ring block size-4 rounded-full border border-primary/60 bg-primary shadow transition-transform hover:scale-110" />
    </SliderPrimitive.Root>
  );
}
