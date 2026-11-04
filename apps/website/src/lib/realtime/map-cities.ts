import type { MapCity, ScreenMapViewState } from './types';

// Curated presets used by controls and hello-state synchronization.
// Keeping this centralized ensures city selection behaves identically across all clients.
export const CITY_MAP_VIEWS: Record<MapCity, ScreenMapViewState> = {
    london: {
        // Centred on Zones 1-2 so the walkable central hops fill the wall.
        longitude: -0.115,
        latitude: 51.51,
        zoom: 13,
        bearing: 0,
        pitch: 0
    },
    paris: {
        longitude: 2.2945,
        latitude: 48.8584,
        zoom: 9,
        bearing: 0,
        pitch: 0
    },
    berlin: {
        longitude: 13.405,
        latitude: 52.52,
        zoom: 9,
        bearing: 0,
        pitch: 0
    },
    madrid: {
        longitude: -3.7038,
        latitude: 40.4168,
        zoom: 9,
        bearing: 0,
        pitch: 0
    },
    rome: {
        longitude: 12.4964,
        latitude: 41.9028,
        zoom: 9,
        bearing: 0,
        pitch: 0
    },
    amsterdam: {
        longitude: 4.9041,
        latitude: 52.3676,
        zoom: 9,
        bearing: 0,
        pitch: 0
    }
};

export function isMapCity(value: unknown): value is MapCity {
    // Type guard used before accepting untrusted city values from network payloads.
    return typeof value === 'string' && value in CITY_MAP_VIEWS;
}

export function getCityMapView(city: MapCity): ScreenMapViewState {
    // Return preset camera for deterministic cross-screen transitions.
    return CITY_MAP_VIEWS[city];
}
