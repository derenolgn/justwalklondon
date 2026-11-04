import { createFileRoute } from '@tanstack/react-router';

import { Button } from '../components/button';
import { Slider } from '../components/slider';
import { controlEngine } from '../lib/realtime/engines/control-engine';
import { sliceLabel } from '../lib/realtime/rush-data';
import { useControlStore } from '../lib/realtime/stores/control-store';
import { RUSH_SLICE_COUNT, type RushScene } from '../lib/realtime/types';

type ControlSearch = {
    // Optional label so multiple control clients can be distinguished in the simulator.
    operator: string;
};

export const Route = createFileRoute('/control')({
    validateSearch: (search: Record<string, unknown>): ControlSearch => {
        return {
            operator: typeof search.operator === 'string' ? search.operator : 'A'
        };
    },
    component: ControlPage
});

// The three acts of the story, in presentation order.
const SCENES: Array<{ value: RushScene; label: string; hint: string }> = [
    { value: 'heartbeat', label: '1 · Heartbeat', hint: 'Stations breathe through the day' },
    { value: 'crush', label: '2 · The crush', hint: 'How full the trains are between stations' },
    { value: 'escape', label: '3 · Just walk', hint: 'Busy hops that are 10 min or less on foot' }
];

// Handy jump points for presenting.
const PRESETS = [
    { label: '08:30', slice: 14 },
    { label: '12:30', slice: 30 },
    { label: '17:45', slice: 51 },
    { label: '22:00', slice: 68 }
];

function ControlPage() {
    // `/control` sends intent (time, scene, zoom) to the bus; screens do the rendering.
    const { operator } = Route.useSearch();
    const sliderValue = useControlStore((state) => state.sliderValue);
    const slice = useControlStore((state) => state.slice);
    const scene = useControlStore((state) => state.scene);
    const isPlaying = useControlStore((state) => state.isPlaying);

    return (
        <main className="h-screen w-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
            <div className="flex h-full w-full flex-col gap-3 p-3">
                <header className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <div>
                        <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                            Operator {operator}
                        </p>
                        <h1 className="text-sm font-semibold">London's Rush Hour</h1>
                    </div>
                    <span className="text-2xl font-semibold tabular-nums">
                        {sliceLabel(null, slice)}
                    </span>
                </header>

                <section className="flex flex-col gap-2">
                    <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                        Scene
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                        {SCENES.map((s) => (
                            <Button
                                key={s.value}
                                onClick={() => controlEngine.setScene(s.value)}
                                variant={scene === s.value ? 'highlight' : 'normal'}
                                title={s.hint}
                            >
                                {s.label}
                            </Button>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-2">
                    <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                        Time of day (typical Tue–Thu)
                    </p>
                    <div className="flex items-center gap-3">
                        <Button onClick={() => controlEngine.togglePlay()} className="w-16">
                            {isPlaying ? 'Pause' : 'Play'}
                        </Button>
                        <Slider
                            value={slice}
                            min={0}
                            max={RUSH_SLICE_COUNT - 1}
                            label="Time of day"
                            className="flex-1"
                            onValueChange={(value) => controlEngine.setSlice(value)}
                            onInteractionChange={(isInteracting) =>
                                controlEngine.setSliderInteracting(isInteracting)
                            }
                        />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        {PRESETS.map((p) => (
                            <Button
                                key={p.label}
                                onClick={() => controlEngine.setSlice(p.slice)}
                                variant={slice === p.slice ? 'highlight' : 'normal'}
                            >
                                {p.label}
                            </Button>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-2">
                    <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                        Zoom
                    </p>
                    <Slider
                        value={sliderValue}
                        label="Zoom"
                        className="w-full"
                        onValueChange={(value) => controlEngine.setSliderValue(value)}
                        onInteractionChange={(isInteracting) =>
                            controlEngine.setSliderInteracting(isInteracting)
                        }
                    />
                </section>
            </div>
        </main>
    );
}
