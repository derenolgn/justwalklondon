import { WebMercatorViewport } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { createFileRoute, useLocation } from '@tanstack/react-router';
import { Map, type MapRef } from '@vis.gl/react-maplibre';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    TYPE,
    WallOverlay,
    WALL_COLS as WALL_COLS_DO,
    WALL_ROWS as WALL_ROWS_DO
} from '../components/wall-overlay';
import { screenEngine } from '../lib/realtime/engines/screen-engine';
import {
    loadRushData,
    walkableHighlights,
    WALKABLE_MAX_MINUTES,
    type RushData,
    type RushLink,
    type RushStation
} from '../lib/realtime/rush-data';
import { useScreenStore } from '../lib/realtime/stores/screen-store';
import type { RushScene, ScreenMapViewState } from '../lib/realtime/types';

import 'maplibre-gl/dist/maplibre-gl.css';

// Wall geometry used by the simulator (`/`). Change these to match the real DO wall.
// Data Observatory: 16 columns x 4 rows of 1920x1080 screens (30720 x 4320 px).
const WALL_COLS = WALL_COLS_DO;
const WALL_ROWS = WALL_ROWS_DO;
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

// Shared timings so transitions feel identical across all screen nodes.
// Data changes ease over ~1s: slow enough to be calm, fast enough to follow playback.
const MAP_TRANSITION_DURATION_MS = 1200;
const DATA_TRANSITION_MS = 900;
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Palette (muted on a dark basemap — no flashing, no pure white floods).
type RGBA = [number, number, number, number];
const AMBER: RGBA = [255, 176, 59, 210];
const COLD: RGBA = [70, 80, 105, 255];
const HOT: RGBA = [255, 72, 72, 235];
const WALK_GREEN: RGBA = [74, 222, 128, 245];
const FAINT: RGBA = [90, 95, 120, 45];

const LINKS_SOURCE_ID = 'rush-links-source';
const LINKS_LAYER_ID = 'rush-links-layer';
const STATIONS_SOURCE_ID = 'rush-stations-source';
const STATIONS_LAYER_ID = 'rush-stations-layer';

type StyledLink = {
    id: string;
    source: [number, number];
    target: [number, number];
    color: RGBA;
    width: number;
};
type StyledStation = { id: string; position: [number, number]; color: RGBA; radius: number };
type Label = { id: string; position: [number, number]; text: string };

export const Route = createFileRoute('/screen')({
    component: ScreenPage
});

function ScreenPage() {
    const { search } = useLocation();
    // Query params identify which physical panel this route instance represents.
    const searchParams = (search as Record<string, unknown>) ?? {};
    const screenC = parseScreenCoordinate(searchParams.c, WALL_COLS, 0);
    const screenR = parseScreenCoordinate(searchParams.r, WALL_ROWS, 0);
    // `/screen?preview=1` shows the WHOLE wall squeezed into one browser window, with
    // drag/scroll enabled, for checking the design on a laptop.
    const isPreview = searchParams.preview !== undefined && searchParams.preview !== '0';

    const mapView = useScreenStore((state) => state.mapView);
    const slice = useScreenStore((state) => state.slice);
    const scene = useScreenStore((state) => state.scene);

    const [isClient, setIsClient] = useState(false);
    const [useDeckWrapper, setUseDeckWrapper] = useState(false);
    const [rush, setRush] = useState<RushData | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [animatedBaseMapView, setAnimatedBaseMapView] = useState(mapView);
    const animationFrameRef = useRef<number | null>(null);
    const [windowWidth, setWindowWidth] = useState(SCREEN_WIDTH);
    const [windowHeight, setWindowHeight] = useState(SCREEN_HEIGHT);
    const [previewView, setPreviewView] = useState<ScreenMapViewState | null>(null);
    const [mapInstance, setMapInstance] = useState<ReturnType<MapRef['getMap']> | null>(null);

    const setMapRef = useCallback((instance: MapRef | null) => {
        setMapInstance(instance?.getMap() ?? null);
    }, []);

    useEffect(() => {
        setIsClient(true);
        // Referencing the engine instantiates it, which opens the websocket to /bus.
        void screenEngine;
        // One DeckGL canvas is fine in its own tab; inside wall iframes we use the lighter
        // MapLibre-only path to avoid exhausting WebGL contexts.
        setUseDeckWrapper(window.self === window.top);
        const onResize = () => {
            setWindowWidth(window.innerWidth);
            setWindowHeight(window.innerHeight);
        };
        onResize();
        window.addEventListener('resize', onResize);
        void loadRushData().then((data) => {
            if (data) setRush(data);
            else setLoadFailed(true);
        });
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Smooth camera moves (zoom slider) — same approach as the starter.
    useEffect(() => {
        if (!isClient) return;
        if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);

        const from = animatedBaseMapView;
        const to = mapView;
        const startTime = performance.now();
        const step = (now: number) => {
            const linearT = Math.min(1, (now - startTime) / MAP_TRANSITION_DURATION_MS);
            setAnimatedBaseMapView(interpolateMapView(from, to, easeInOutCubic(linearT)));
            animationFrameRef.current = linearT < 1 ? requestAnimationFrame(step) : null;
        };
        animationFrameRef.current = requestAnimationFrame(step);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [isClient, mapView]);

    const wallMapView = useMemo(() => {
        if (!isPreview) return deriveScreenMapView(animatedBaseMapView, screenC, screenR);
        // Preview: keep the wall centre, zoom out so the full wall width fits this window.
        const fit = Math.log2(windowWidth / (SCREEN_WIDTH * WALL_COLS));
        return { ...animatedBaseMapView, zoom: animatedBaseMapView.zoom + fit };
    }, [animatedBaseMapView, screenC, screenR, isPreview, windowWidth]);

    // Drag/scroll/pinch is local to this browser window (handy for exploring on a laptop).
    // Any shared camera change from the controller (zoom slider) snaps every screen back.
    useEffect(() => {
        setPreviewView(null);
    }, [wallMapView]);
    const localScreenMapView = previewView ?? wallMapView;

    // --- Data → visual encoding (shared by both renderers) ---------------------------------
    const highlights = useMemo(() => (rush ? walkableHighlights(rush, slice) : []), [rush, slice]);
    // Pair keys so both directions of a highlighted hop light up.
    const highlightIds = useMemo(
        () => new Set(highlights.map((h) => pairKey(h.link))),
        [highlights]
    );

    const styledLinks = useMemo<StyledLink[]>(
        () => (rush ? rush.links.map((l) => styleLink(l, rush, scene, slice, highlightIds)) : []),
        [rush, scene, slice, highlightIds]
    );
    const styledStations = useMemo<StyledStation[]>(() => {
        if (!rush) return [];
        const endpoints = new Set(highlights.flatMap((h) => [h.link.from, h.link.to]));
        return rush.stations.map((s) => styleStation(s, rush, scene, slice, endpoints));
    }, [rush, scene, slice, highlights]);

    const labels = useMemo<Label[]>(() => {
        if (scene !== 'escape') return [];
        // Rank number only: names and walk times sit in the ranking panel under the same number.
        // Neighbouring hops (e.g. Borough and Southwark) are too close for longer wall-size labels.
        return highlights.map(({ link }, i) => ({
            id: link.id,
            position: midpoint(link.source, link.target),
            text: String(i + 1)
        }));
    }, [scene, highlights]);

    // --- DeckGL path (top-level tab) ---------------------------------------------------------
    // Preview shrinks the whole 30720px-wide wall into this window: scale marks and text to match.
    const previewScale = windowWidth / (SCREEN_WIDTH * WALL_COLS);
    const markScale = isPreview ? previewScale : 1;
    const labelsVisible = localScreenMapView.zoom >= (isPreview ? 10 : 11);
    const layers = useMemo(() => {
        const transitions = { getColor: DATA_TRANSITION_MS, getWidth: DATA_TRANSITION_MS };
        return [
            new LineLayer<StyledLink>({
                id: 'rush-links',
                data: styledLinks,
                getSourcePosition: (d) => d.source,
                getTargetPosition: (d) => d.target,
                getColor: (d) => d.color,
                getWidth: (d) => d.width,
                widthUnits: 'pixels',
                widthScale: markScale,
                transitions,
                updateTriggers: { getColor: [scene, slice], getWidth: [scene, slice] }
            }),
            new ScatterplotLayer<StyledStation>({
                id: 'rush-stations',
                data: styledStations,
                getPosition: (d) => d.position,
                getRadius: (d) => d.radius,
                getFillColor: (d) => d.color,
                radiusUnits: 'pixels',
                // Preview packs the whole wall into one window, so shrink marks to match.
                radiusScale: markScale,
                transitions: { getRadius: DATA_TRANSITION_MS, getFillColor: DATA_TRANSITION_MS },
                updateTriggers: { getRadius: [scene, slice], getFillColor: [scene, slice] }
            }),
            new TextLayer<Label>({
                id: 'rush-labels',
                data: labels,
                getPosition: (d) => d.position,
                getText: (d) => d.text,
                // Labels pile up when zoomed far out; hide them below city-scale zoom.
                visible: labelsVisible,
                getSize: TYPE.secondary,
                sizeScale: markScale,
                getColor: [230, 255, 235, 255],
                outlineWidth: 6,
                outlineColor: [10, 12, 18, 255],
                fontSettings: { sdf: true },
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                fontWeight: 600,
                // Offset is in screen pixels, so shrink it with the preview like the text itself.
                getPixelOffset: [0, -90 * markScale],
                characterSet: 'auto'
            })
        ];
    }, [styledLinks, styledStations, labels, scene, slice, markScale, labelsVisible]);

    // --- MapLibre fallback path (wall iframes) ----------------------------------------------
    const linksGeojson = useMemo(
        () => ({
            type: 'FeatureCollection' as const,
            features: styledLinks.map((l) => ({
                type: 'Feature' as const,
                properties: { color: rgbaCss(l.color), width: l.width },
                geometry: { type: 'LineString' as const, coordinates: [l.source, l.target] }
            }))
        }),
        [styledLinks]
    );
    const stationsGeojson = useMemo(
        () => ({
            type: 'FeatureCollection' as const,
            features: styledStations.map((s) => ({
                type: 'Feature' as const,
                properties: { color: rgbaCss(s.color), radius: s.radius },
                geometry: { type: 'Point' as const, coordinates: s.position }
            }))
        }),
        [styledStations]
    );

    useEffect(() => {
        if (!isClient || useDeckWrapper || !mapInstance) return;
        const sync = () => {
            if (!mapInstance.isStyleLoaded()) return;
            // Create sources/layers once, then update in place with setData.
            const links = mapInstance.getSource(LINKS_SOURCE_ID) as
                | { setData: (d: unknown) => void }
                | undefined;
            if (links) links.setData(linksGeojson);
            else {
                mapInstance.addSource(LINKS_SOURCE_ID, {
                    type: 'geojson',
                    data: linksGeojson as never
                });
                mapInstance.addLayer({
                    id: LINKS_LAYER_ID,
                    type: 'line',
                    source: LINKS_SOURCE_ID,
                    layout: { 'line-cap': 'round' },
                    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] }
                });
            }
            const stations = mapInstance.getSource(STATIONS_SOURCE_ID) as
                | { setData: (d: unknown) => void }
                | undefined;
            if (stations) stations.setData(stationsGeojson);
            else {
                mapInstance.addSource(STATIONS_SOURCE_ID, {
                    type: 'geojson',
                    data: stationsGeojson as never
                });
                mapInstance.addLayer({
                    id: STATIONS_LAYER_ID,
                    type: 'circle',
                    source: STATIONS_SOURCE_ID,
                    paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius'] }
                });
            }
        };
        sync();
        mapInstance.on('load', sync);
        return () => {
            mapInstance.off('load', sync);
        };
    }, [isClient, useDeckWrapper, mapInstance, linksGeojson, stationsGeojson]);

    return (
        <main className={`relative h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100`}>
            <div className="absolute inset-0">
                {isClient && useDeckWrapper ? (
                    <DeckGL
                        controller={{ dragRotate: false, doubleClickZoom: true, scrollZoom: true }}
                        viewState={localScreenMapView}
                        onViewStateChange={({ viewState }) => {
                            const v = viewState as ScreenMapViewState;
                            setPreviewView({
                                longitude: v.longitude,
                                latitude: v.latitude,
                                zoom: v.zoom,
                                bearing: v.bearing,
                                pitch: v.pitch
                            });
                        }}
                        layers={layers}
                        style={{ width: '100%', height: '100%' }}
                    >
                        <Map reuseMaps attributionControl={false} mapStyle={MAP_STYLE} />
                    </DeckGL>
                ) : null}
                {isClient && !useDeckWrapper ? (
                    <Map
                        ref={setMapRef}
                        reuseMaps
                        attributionControl={false}
                        mapStyle={MAP_STYLE}
                        longitude={localScreenMapView.longitude}
                        latitude={localScreenMapView.latitude}
                        zoom={localScreenMapView.zoom}
                        bearing={localScreenMapView.bearing}
                        pitch={localScreenMapView.pitch}
                        style={{ width: '100%', height: '100%' }}
                        dragRotate={false}
                        onMove={(e) =>
                            setPreviewView({
                                longitude: e.viewState.longitude,
                                latitude: e.viewState.latitude,
                                zoom: e.viewState.zoom,
                                bearing: e.viewState.bearing,
                                pitch: e.viewState.pitch
                            })
                        }
                    />
                ) : null}
            </div>

            {isPreview ? (
                // Outline of what the real wall shows (full width, wall aspect ratio).
                <div
                    className="pointer-events-none absolute top-1/2 left-0 z-10 w-full -translate-y-1/2 border-y-2 border-dashed border-zinc-500/60"
                    style={{
                        aspectRatio: `${SCREEN_WIDTH * WALL_COLS} / ${SCREEN_HEIGHT * WALL_ROWS}`
                    }}
                />
            ) : null}

            <WallOverlay
                data={rush}
                scene={scene}
                slice={slice}
                loadFailed={loadFailed}
                mode={
                    isPreview
                        ? {
                              kind: 'preview',
                              top: (windowHeight - SCREEN_HEIGHT * WALL_ROWS * previewScale) / 2,
                              scale: previewScale
                          }
                        : {
                              kind: 'tile',
                              c: screenC,
                              r: screenR,
                              scale: windowWidth / SCREEN_WIDTH
                          }
                }
            />
        </main>
    );
}

// --- Encoding helpers ------------------------------------------------------------------------

function styleLink(
    link: RushLink,
    data: RushData,
    scene: RushScene,
    slice: number,
    highlightIds: Set<string>
): StyledLink {
    // sqrt keeps mid-sized loads visible next to the very busiest hops.
    const n = Math.sqrt(link.load[slice] / data.maxLoad);
    const walkable = link.walk !== null && link.walk <= WALKABLE_MAX_MINUTES;
    let color: RGBA = FAINT;
    let width = 1.5;

    if (scene === 'crush') {
        color = lerpColor(COLD, HOT, n);
        width = 1 + 14 * n;
    } else if (scene === 'escape') {
        if (highlightIds.has(pairKey(link))) {
            color = WALK_GREEN;
            width = 5 + 14 * n;
        } else if (walkable) {
            color = [WALK_GREEN[0], WALK_GREEN[1], WALK_GREEN[2], 80];
            width = 2;
        }
    }
    return { id: link.id, source: link.source, target: link.target, color, width };
}

function styleStation(
    station: RushStation,
    data: RushData,
    scene: RushScene,
    slice: number,
    endpoints: Set<string>
): StyledStation {
    const n = Math.sqrt(station.flow[slice] / data.maxFlow);
    if (scene === 'heartbeat') {
        return { id: station.id, position: station.position, color: AMBER, radius: 2 + 42 * n };
    }
    if (scene === 'escape' && endpoints.has(station.id)) {
        return {
            id: station.id,
            position: station.position,
            color: [235, 255, 240, 255],
            radius: 9
        };
    }
    return { id: station.id, position: station.position, color: [150, 155, 175, 140], radius: 2.5 };
}

function pairKey(link: RushLink) {
    return [link.from, link.to].sort().join('|');
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
    const k = Math.min(1, Math.max(0, t));
    return [
        Math.round(lerp(a[0], b[0], k)),
        Math.round(lerp(a[1], b[1], k)),
        Math.round(lerp(a[2], b[2], k)),
        Math.round(lerp(a[3], b[3], k))
    ];
}

function rgbaCss(c: RGBA) {
    return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
}

// --- Wall camera helpers (from the starter) --------------------------------------------------

function parseScreenCoordinate(value: unknown, size: number, fallback: number) {
    if (value === null || value === undefined) return Math.min(size - 1, Math.max(0, fallback));
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed)) return Math.min(size - 1, Math.max(0, fallback));
    return Math.min(size - 1, Math.max(0, parsed));
}

function deriveScreenMapView(
    baseView: ScreenMapViewState,
    c: number,
    r: number
): ScreenMapViewState {
    // Project the wall centre to pixels, offset by this tile's position, unproject back.
    const viewport = new WebMercatorViewport({
        ...baseView,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT
    });
    const [centerX, centerY] = viewport.project([baseView.longitude, baseView.latitude]);
    const pixelOffsetX = (c + 0.5 - WALL_COLS / 2) * SCREEN_WIDTH;
    const pixelOffsetY = (r + 0.5 - WALL_ROWS / 2) * SCREEN_HEIGHT;
    const [longitude, latitude] = viewport.unproject([
        centerX + pixelOffsetX,
        centerY + pixelOffsetY
    ]);
    return { ...baseView, longitude, latitude };
}

function interpolateMapView(
    from: ScreenMapViewState,
    to: ScreenMapViewState,
    t: number
): ScreenMapViewState {
    return {
        longitude: lerp(from.longitude, to.longitude, t),
        latitude: lerp(from.latitude, to.latitude, t),
        zoom: lerp(from.zoom, to.zoom, t),
        bearing: lerp(from.bearing, to.bearing, t),
        pitch: lerp(from.pitch, to.pitch, t)
    };
}

function lerp(from: number, to: number, t: number) {
    return from + (to - from) * t;
}

function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
