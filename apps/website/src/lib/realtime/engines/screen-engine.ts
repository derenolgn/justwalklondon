import { screenStore } from '../stores/screen-store';
import type {
    BusMessage,
    HelloBusMessage,
    ScreenMapViewMessage,
    ScreenMapViewState,
    ScreenRushMessage,
    ScreenStoreState
} from '../types';
import { isRushScene, sanitizeSlice } from '../types';
import { BusEngine } from './bus-engine';

export class ScreenEngine extends BusEngine<ScreenStoreState> {
    private constructor() {
        super('screen', screenStore);
    }

    static getInstance() {
        const globalWithScreenEngine = globalThis as typeof globalThis & {
            __screenEngineInstance?: ScreenEngine;
        };

        if (!globalWithScreenEngine.__screenEngineInstance) {
            globalWithScreenEngine.__screenEngineInstance = new ScreenEngine();
        }

        return globalWithScreenEngine.__screenEngineInstance;
    }

    setMapView(view: Partial<ScreenMapViewState>) {
        // Merge patch updates so callers can provide only changed camera fields.
        this.store.setState((prev) => ({
            ...prev,
            mapView: {
                ...prev.mapView,
                ...view
            }
        }));
    }

    protected override onMessage(message: BusMessage) {
        if (message.type === 'screen/map-view') {
            const mapViewMessage = message as ScreenMapViewMessage;
            this.applyMapViewMessage(mapViewMessage);
            return;
        }

        if (message.type === 'screen/rush') {
            this.applyRush(message as ScreenRushMessage);
        }
    }

    private applyRush(message: Partial<ScreenRushMessage>) {
        // Validate untrusted slice/scene before touching shared render state.
        const slice = sanitizeSlice(message.slice);
        const scene = isRushScene(message.scene) ? message.scene : null;
        this.store.setState((prev) => {
            const nextSlice = slice ?? prev.slice;
            const nextScene = scene ?? prev.scene;
            if (nextSlice === prev.slice && nextScene === prev.scene) return prev;
            return { ...prev, slice: nextSlice, scene: nextScene };
        });
    }

    protected override onHello(hello: HelloBusMessage) {
        if (!hello.state) return;
        // Apply the same message handlers used for live events so hello-state and realtime updates
        // follow one code path and stay behaviorally consistent.
        this.applyMapViewMessage({
            type: 'screen/map-view',
            view: { zoom: hello.state.zoom }
        });
        this.applyRush({ slice: hello.state.slice, scene: hello.state.scene });
    }

    private applyMapViewMessage(mapViewMessage: ScreenMapViewMessage) {
        // Apply only the camera fields that arrived as valid numbers.
        let nextView = this.store.state.mapView;

        if (mapViewMessage.view && typeof mapViewMessage.view === 'object') {
            const view = mapViewMessage.view;
            nextView = {
                ...nextView,
                longitude: typeof view.longitude === 'number' ? view.longitude : nextView.longitude,
                latitude: typeof view.latitude === 'number' ? view.latitude : nextView.latitude,
                zoom: typeof view.zoom === 'number' ? view.zoom : nextView.zoom,
                bearing: typeof view.bearing === 'number' ? view.bearing : nextView.bearing,
                pitch: typeof view.pitch === 'number' ? view.pitch : nextView.pitch
            };
        }

        this.setMapView(nextView);
    }
}

export const screenEngine = ScreenEngine.getInstance();
