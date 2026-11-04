import { Slider as BaseSlider } from '@base-ui/react/slider';
import { useRef } from 'react';

type SliderProps = {
    value: number;
    onValueChange: (value: number) => void;
    onInteractionChange: (isInteracting: boolean) => void;
    min?: number;
    max?: number;
    className?: string;
    label?: string;
};

export function Slider({
    value,
    onValueChange,
    onInteractionChange,
    min = 0,
    max = 100,
    className = 'w-56',
    label = 'Value'
}: SliderProps) {
    // We track active interaction locally so CSS transitions can be disabled while dragging.
    // This prevents the thumb/indicator from visually lagging behind pointer movement.
    const hasOngoingInteraction = useRef(false);
    return (
        <BaseSlider.Root
            min={min}
            max={max}
            step={1}
            value={value}
            onValueChange={(nextValue) => {
                // Drag-time updates drive realtime broadcasts (throttled in engine layer).
                hasOngoingInteraction.current = true;
                onInteractionChange(true);
                onValueChange(nextValue);
            }}
            onValueCommitted={(nextValue) => {
                // Commit event is useful for analytics / edge-triggered effects.
                onValueChange(nextValue);
                onInteractionChange(false);
                hasOngoingInteraction.current = false;
            }}
            className={className}
        >
            <BaseSlider.Control className="flex w-full touch-none items-center py-3 select-none">
                <BaseSlider.Track className="h-1 w-full rounded-sm bg-[var(--muted)] shadow-[inset_0_0_0_1px_var(--border)] select-none">
                    <BaseSlider.Indicator
                        className={`rounded-sm bg-[var(--primary)] select-none ${hasOngoingInteraction.current ? '' : 'transition-all'}`}
                    />
                    <BaseSlider.Thumb
                        aria-label={label}
                        className={`size-4 rounded-full bg-[var(--foreground)] opacity-100 outline-1 outline-[var(--border)] select-none has-focus-visible:outline-2 has-focus-visible:outline-[var(--ring)] ${hasOngoingInteraction.current ? '' : 'transition-all'}`}
                    />
                </BaseSlider.Track>
            </BaseSlider.Control>
        </BaseSlider.Root>
    );
}
