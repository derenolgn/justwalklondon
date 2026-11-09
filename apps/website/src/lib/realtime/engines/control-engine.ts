import { throttle } from '@tanstack/pacer';

import { controlStore } from '../stores/control-store';
import type {
    BusMessage,
    ControlSliderMessage,
    ControlStoreState,
    HelloBusMessage,
    RushScene,
    ScreenMapViewMessage,
    ScreenRushMessage
} from '../types';
import { isRushScene, RUSH_SLICE_COUNT, sanitizeSlice } from '../types';
import { BusEngine } from './bus-engine';

const SLIDER_BROADCAST_WAIT_MS = 100;
const SLIDER_MIN = 0;
const SLIDER_MAX = 100;
const MAP_ZOOM_MIN = 6;
const MAP_ZOOM_MAX = 18;
// Autoplay pace: one quarter hour per tick. Slow on purpose (viewer comfort on the wall).
const PLAY_TICK_MS = 1500;
// Autoplay covers the service day 05:00 -> 00:30 and loops (night slices are near-empty).
const PLAY_LAST_SLICE = 78;

export class ControlEngine extends BusEngine<ControlStoreState> {
    // Slider moves can emit many events per second; throttle keeps interaction smooth locally
    // while reducing websocket chatter for all connected peers.
    private readonly broadcastSliderValueThrottled = throttle(
        (value: number) => {
            this.send({
                type: 'control/slider',
                value,
                peerId: this.getPeerId() ?? undefined
            });
        },
        {
            wait: SLIDER_BROADCAST_WAIT_MS,
            leading: true,
            trailing: true
        }
    );

    private readonly broadcastMapZoomThrottled = throttle(
        (zoom: number) => {
            this.send({
                type: 'screen/map-view',
                view: { zoom },
                peerId: this.getPeerId() ?? undefined
            });
        },
        {
            wait: SLIDER_BROADCAST_WAIT_MS,
            leading: true,
            trailing: true
        }
    );

    private playTimer: ReturnType<typeof setInterval> | null = null;

    private readonly broadcastSliceThrottled = throttle(
        (slice: number) => {
            this.send({
                type: 'screen/rush',
                slice,
                peerId: this.getPeerId() ?? undefined
            });
        },
        { wait: SLIDER_BROADCAST_WAIT_MS, leading: true, trailing: true }
    );

    private constructor() {
        super('control', controlStore);
    }

    setSlice(value: number) {
        const slice = sanitizeSlice(value);
        if (slice === null) return;
        this.store.setState((prev) => (prev.slice === slice ? prev : { ...prev, slice }));
        this.broadcastSliceThrottled(slice);
    }

    setScene(scene: RushScene) {
        this.store.setState((prev) => (prev.scene === scene ? prev : { ...prev, scene }));
        this.send({ type: 'screen/rush', scene, peerId: this.getPeerId() ?? undefined });
    }

    togglePlay() {
        if (typeof window === 'undefined') return;
        if (this.playTimer !== null) {
            clearInterval(this.playTimer);
            this.playTimer = null;
            this.store.setState((prev) => ({ ...prev, isPlaying: false }));
            return;
        }
        this.store.setState((prev) => ({ ...prev, isPlaying: true }));
        this.playTimer = setInterval(() => {
            const current = this.store.state.slice;
            const next = current >= PLAY_LAST_SLICE ? 0 : (current + 1) % RUSH_SLICE_COUNT;
            this.setSlice(next);
        }, PLAY_TICK_MS);
    }

    static getInstance() {
        const globalWithControlEngine = globalThis as typeof globalThis & {
            __controlEngineInstance?: ControlEngine;
        };

        if (!globalWithControlEngine.__controlEngineInstance) {
            globalWithControlEngine.__controlEngineInstance = new ControlEngine();
        }

        return globalWithControlEngine.__controlEngineInstance;
    }

    setSliderInteracting(isSliderInteracting: boolean) {
        // Stored so remote updates can be ignored while local user is dragging.
        this.store.setState((prev) => {
            if (prev.isSliderInteracting === isSliderInteracting) return prev;
            return {
                ...prev,
                isSliderInteracting
            };
        });
    }

    setSliderValue(value: number) {
        const clampedValue = this.clampSliderValue(value);

        this.store.setState((prev) => {
            if (prev.sliderValue === clampedValue) return prev;
            return {
                ...prev,
                sliderValue: clampedValue
            };
        });

        this.broadcastSliderValueThrottled(clampedValue);
        // Slider value is the source-of-truth input for zoom UX in this demo.
        this.broadcastMapZoomThrottled(this.zoomFromSlider(clampedValue));
    }

    protected override onMessage(message: BusMessage) {
        if (message.type === 'control/slider') {
            const sliderMessage = message as ControlSliderMessage;
            if (typeof sliderMessage.value !== 'number') return;
            this.store.setState((prev) => {
                // If the local user is actively dragging, ignore remote slider echoes
                // to avoid "fighting cursors" and jitter.
                if (prev.isSliderInteracting) return prev;

                const clampedValue = this.clampSliderValue(sliderMessage.value);
                if (prev.sliderValue === clampedValue) return prev;

                return {
                    ...prev,
                    sliderValue: clampedValue
                };
            });
            return;
        }

        if (message.type === 'screen/map-view') {
            // Mirror incoming map events so all control clients display shared state.
            const mapViewMessage = message as ScreenMapViewMessage;
            const zoom = mapViewMessage.view?.zoom;
            if (typeof zoom !== 'number') return;
            this.store.setState((prev) => {
                const nextSliderValue = this.sliderFromZoom(zoom);
                return prev.sliderValue === nextSliderValue
                    ? prev
                    : { ...prev, sliderValue: nextSliderValue };
            });
            return;
        }

        if (message.type === 'screen/rush') {
            // Mirror other operators' time/scene changes; ignore while dragging locally.
            const rush = message as ScreenRushMessage;
            const slice = sanitizeSlice(rush.slice);
            const scene = isRushScene(rush.scene) ? rush.scene : null;
            this.store.setState((prev) => {
                const nextSlice = slice !== null && !prev.isSliderInteracting ? slice : prev.slice;
                const nextScene = scene ?? prev.scene;
                if (nextSlice === prev.slice && nextScene === prev.scene) return prev;
                return { ...prev, slice: nextSlice, scene: nextScene };
            });
            return;
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        const state = hello.state;
        if (!state) return;

        // Rehydrate control UI from bus snapshot so newly opened tablets are immediately in sync.
        const slice = sanitizeSlice(state.slice);
        const scene = isRushScene(state.scene) ? state.scene : null;
        this.store.setState((prev) => ({
            ...prev,
            sliderValue: this.sliderFromZoom(state.zoom),
            slice: slice ?? prev.slice,
            scene: scene ?? prev.scene
        }));
    }

    private clampSliderValue(value: number) {
        // Single clamp utility keeps incoming and outgoing slider values consistent.
        return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, value));
    }

    private zoomFromSlider(sliderValue: number) {
        // Linear mapping keeps control UI simple and predictable.
        const normalized = (sliderValue - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);
        return MAP_ZOOM_MIN + normalized * (MAP_ZOOM_MAX - MAP_ZOOM_MIN);
    }

    private sliderFromZoom(zoom: number) {
        const clampedZoom = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, zoom));
        const normalized = (clampedZoom - MAP_ZOOM_MIN) / (MAP_ZOOM_MAX - MAP_ZOOM_MIN);
        return this.clampSliderValue(normalized * (SLIDER_MAX - SLIDER_MIN) + SLIDER_MIN);
    }
}

export const controlEngine = ControlEngine.getInstance();
