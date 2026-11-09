// 08:30-08:45, the heart of the morning peak.
export const DEFAULT_RUSH_SLICE = 14;
export const RUSH_SLICE_COUNT = 96;
export const RUSH_SCENES: RushScene[] = ['heartbeat', 'crush', 'escape'];

export function isRushScene(value: unknown): value is RushScene {
    return typeof value === 'string' && (RUSH_SCENES as string[]).includes(value);
}

export function sanitizeSlice(value: unknown): number | null {
    // Slices arrive over the network: accept integers only, clamp into the service day.
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(RUSH_SLICE_COUNT - 1, Math.max(0, Math.round(value)));
}

export type BusMessage = {
    // Keep message kinds namespaced (`control/*`, `screen/*`).
    type: string;
    peerId?: string;
    peerCount?: number;
    [key: string]: unknown;
};

export type HelloBusMessage = BusMessage & {
    type: 'hello';
    peerId: string;
    state?: BusSharedState;
};

export type ControlSliderMessage = BusMessage & {
    type: 'control/slider';
    value: number;
};

// Story scenes for "Just Walk, London".
// heartbeat = station entries/exits pulse; crush = train loads between stations;
// escape = hops that are quicker (or nearly as quick) to walk.
export type RushScene = 'heartbeat' | 'crush' | 'escape';

export type BusSharedState = {
    zoom: number;
    // Quarter-hour index into the NUMBAT service day (0 = 05:00-05:15 ... 95 = 04:45-05:00).
    slice: number;
    scene: RushScene;
};

export type ScreenRushMessage = BusMessage & {
    type: 'screen/rush';
    slice?: number;
    scene?: RushScene;
};

export type ScreenMapViewState = {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
};

export type ScreenMapViewMessage = BusMessage & {
    type: 'screen/map-view';
    view: Partial<ScreenMapViewState>;
};

// Home camera: centred on Zones 1-2 so the walkable central hops fill the wall.
export const LONDON_VIEW: ScreenMapViewState = {
    longitude: -0.115,
    latitude: 51.51,
    zoom: 13,
    bearing: 0,
    pitch: 0
};

export type EngineRole = 'screen' | 'control';

export type EngineConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type EngineStoreState = {
    role: EngineRole;
    peerId: string | null;
    connection: EngineConnectionState;
    messageCount: number;
    lastMessageType: string | null;
    lastMessageAt: number | null;
    lastError: string | null;
};

export const createInitialEngineStoreState = (role: EngineRole): EngineStoreState => ({
    role,
    peerId: null,
    connection: 'idle',
    messageCount: 0,
    lastMessageType: null,
    lastMessageAt: null,
    lastError: null
});

export type ControlStoreState = EngineStoreState & {
    sliderValue: number;
    isSliderInteracting: boolean;
    slice: number;
    scene: RushScene;
    isPlaying: boolean;
};

export type ScreenStoreState = EngineStoreState & {
    mapView: ScreenMapViewState;
    slice: number;
    scene: RushScene;
};

export const createInitialControlStoreState = (): ControlStoreState => ({
    ...createInitialEngineStoreState('control'),
    // 58 maps to zoom ~13: Zones 1-3 fill the wall's height (4 screens).
    sliderValue: 58,
    isSliderInteracting: false,
    slice: DEFAULT_RUSH_SLICE,
    scene: 'heartbeat',
    isPlaying: false
});

export const createInitialScreenStoreState = (): ScreenStoreState => ({
    ...createInitialEngineStoreState('screen'),
    mapView: { ...LONDON_VIEW },
    slice: DEFAULT_RUSH_SLICE,
    scene: 'heartbeat'
});
