import { throttle } from '@tanstack/pacer';

import { loadArcSegmentsDataset } from '../arc-segments';
import { getCityMapView, isMapCity } from '../map-cities';
import { controlStore } from '../stores/control-store';
import type {
    BusMessage,
    ControlSliderMessage,
    ControlStoreState,
    HelloBusMessage,
    MapCity,
    RushScene,
    ScreenMapViewMessage,
    ScreenRushMessage,
    ScreenSegmentSelectionMessage
} from '../types';
import { isRushScene, RUSH_SLICE_COUNT, sanitizeSlice } from '../types';
import { BusEngine } from './bus-engine';

const SLIDER_BROADCAST_WAIT_MS = 100;
const SLIDER_MIN = 0;
const SLIDER_MAX = 100;
const MAP_ZOOM_MIN = 6;
const MAP_ZOOM_MAX = 18;
const DEFAULT_SHUFFLE_SELECTION_COUNT = 24;
// Autoplay pace: one quarter hour per tick. Slow on purpose (viewer comfort on the wall).
const PLAY_TICK_MS = 1500;
// Autoplay covers the service day 05:00 -> 00:30 and loops (night slices are near-empty).
const PLAY_LAST_SLICE = 78;

export class ControlEngine extends BusEngine<ControlStoreState> {
    // Cached once loaded to avoid repeated dataset fetches from the control route.
    private segmentCount: number | null = null;

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
                city: this.store.state.selectedCity,
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

    selectCity(city: MapCity) {
        let hasChanged = false;
        this.store.setState((prev) => {
            if (prev.selectedCity === city) return prev;
            hasChanged = true;
            return {
                ...prev,
                selectedCity: city
            };
        });

        if (!hasChanged) return;

        // Broadcast full target view when city changes so all screens jump to the same anchor.
        this.send({
            type: 'screen/map-view',
            city,
            view: {
                ...getCityMapView(city),
                zoom: this.zoomFromSlider(this.store.state.sliderValue)
            },
            peerId: this.getPeerId() ?? undefined
        });
    }

    async shuffleSegments() {
        // Demo helper: choose a random subset for immediate visual feedback.
        const segmentCount = await this.ensureSegmentCount();
        if (segmentCount <= 0) return;

        const targetCount = Math.min(DEFAULT_SHUFFLE_SELECTION_COUNT, segmentCount);
        const indexes = this.pickRandomIndexes(segmentCount, targetCount);

        this.store.setState((prev) => ({
            ...prev,
            selectedSegmentIndexes: indexes
        }));

        this.send({
            type: 'screen/segment-selection',
            indexes,
            peerId: this.getPeerId() ?? undefined
        });
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
            this.store.setState((prev) => {
                const nextCity = isMapCity(mapViewMessage.city)
                    ? mapViewMessage.city
                    : prev.selectedCity;
                const nextSliderValue =
                    typeof mapViewMessage.view?.zoom === 'number'
                        ? this.sliderFromZoom(mapViewMessage.view.zoom)
                        : prev.sliderValue;

                if (prev.selectedCity === nextCity && prev.sliderValue === nextSliderValue) {
                    return prev;
                }

                return {
                    ...prev,
                    selectedCity: nextCity,
                    sliderValue: nextSliderValue
                };
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

        if (message.type === 'screen/segment-selection') {
            const segmentSelectionMessage = message as ScreenSegmentSelectionMessage;
            if (!Array.isArray(segmentSelectionMessage.indexes)) return;
            const indexes = segmentSelectionMessage.indexes
                .filter((value): value is number => Number.isInteger(value) && value >= 0)
                .slice()
                .sort((a, b) => a - b);

            this.store.setState((prev) => {
                if (arraysEqual(prev.selectedSegmentIndexes, indexes)) return prev;
                return {
                    ...prev,
                    selectedSegmentIndexes: indexes
                };
            });
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        const state = hello.state;
        if (!state) return;

        // Rehydrate control UI from bus snapshot so newly opened tablets are immediately in sync.
        this.store.setState((prev) => {
            const nextCity = state.city;
            const nextSliderValue = this.sliderFromZoom(state.zoom);
            const nextSelectedIndexes = Array.isArray(state.selectedSegmentIndexes)
                ? state.selectedSegmentIndexes
                      .filter((value): value is number => Number.isInteger(value) && value >= 0)
                      .slice()
                      .sort((a, b) => a - b)
                : prev.selectedSegmentIndexes;
            if (
                prev.selectedCity === nextCity &&
                prev.sliderValue === nextSliderValue &&
                arraysEqual(prev.selectedSegmentIndexes, nextSelectedIndexes)
            ) {
                return prev;
            }
            return {
                ...prev,
                selectedCity: nextCity,
                sliderValue: nextSliderValue,
                selectedSegmentIndexes: nextSelectedIndexes
            };
        });
        const slice = sanitizeSlice(state.slice);
        const scene = isRushScene(state.scene) ? state.scene : null;
        this.store.setState((prev) => ({
            ...prev,
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

    private async ensureSegmentCount() {
        if (this.segmentCount !== null) return this.segmentCount;
        if (typeof window === 'undefined') return 0;

        const payload = await loadArcSegmentsDataset();
        if (!payload) {
            // Soft-fail: control features should keep working even if optional data fetch fails.
            return 0;
        }

        this.segmentCount = payload.length;
        return this.segmentCount;
    }

    private pickRandomIndexes(maxExclusive: number, count: number) {
        // Fisher-Yates shuffle for unbiased random subset.
        const pool = Array.from({ length: maxExclusive }, (_, index) => index);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, count).sort((a, b) => a - b);
    }
}

export const controlEngine = ControlEngine.getInstance();

function arraysEqual(a: number[], b: number[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
