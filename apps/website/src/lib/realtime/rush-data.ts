// Loader + runtime validation for the rush-hour dataset built by scripts/build_data.py.
// Source: TfL NUMBAT 2025 (typical Tue-Thu) + TfL walking times between stations (Zones 1-3).

const RUSH_DATA_URL = '/data/rush.json';

// Keep the story inside inner London: TfL's walking-times data only covers Zones 1-3.
// Stations on a zone boundary ("3/4") count as their lowest zone.
export const MAX_ZONE = 3;

// A hop is "walkable" if TfL's walking map puts it at this many minutes or fewer.
export const WALKABLE_MAX_MINUTES = 10;
// How many of the busiest walkable hops the escape scene highlights at once.
// Matches the ranking panel (2 per screen row x 3 rows) so map and list show the same hops.
export const ESCAPE_HIGHLIGHT_COUNT = 6;

export type RushStation = {
    id: string;
    name: string;
    position: [number, number]; // [lon, lat]
    // entries + exits per quarter hour
    flow: number[];
};

export type RushLink = {
    id: string;
    from: string;
    to: string;
    fromName: string;
    toName: string;
    line: string;
    source: [number, number];
    target: [number, number];
    walk: number | null;
    load: number[];
};

export type RushData = {
    slices: string[];
    stations: RushStation[];
    links: RushLink[];
    maxFlow: number;
    maxLoad: number;
};

let request: Promise<RushData | null> | null = null;

export function loadRushData(): Promise<RushData | null> {
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (!request) {
        request = (async () => {
            try {
                const response = await fetch(RUSH_DATA_URL, {
                    headers: { accept: 'application/json' }
                });
                if (!response.ok) return null;
                return parseRushData(await response.json());
            } catch {
                return null;
            }
        })().then((data) => {
            // Failed reads should not poison the cache forever.
            if (!data) request = null;
            return data;
        });
    }
    return request;
}

function lowestZone(zone: unknown) {
    // "2/3" -> 2, "1" -> 1; non-numeric zones (e.g. "CPC" = outside London) are dropped.
    const zones = String(zone ?? '')
        .split('/')
        .map(Number)
        .filter((z) => Number.isFinite(z) && z > 0);
    return zones.length ? Math.min(...zones) : Number.POSITIVE_INFINITY;
}

function isNumberArray(value: unknown, length: number): value is number[] {
    return (
        Array.isArray(value) &&
        value.length === length &&
        value.every((v) => typeof v === 'number' && Number.isFinite(v))
    );
}

function parseRushData(payload: unknown): RushData | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const raw = payload as Record<string, unknown>;
    if (!Array.isArray(raw.slices) || raw.slices.length === 0) return null;
    const slices = raw.slices.filter((s): s is string => typeof s === 'string');
    const n = slices.length;
    if (typeof raw.stations !== 'object' || raw.stations === null || !Array.isArray(raw.links)) {
        return null;
    }

    const stationById = new Map<string, RushStation>();
    let maxFlow = 1;
    for (const [id, value] of Object.entries(raw.stations as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) continue;
        const s = value as Record<string, unknown>;
        if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
        if (lowestZone(s.zone) > MAX_ZONE) continue;
        if (!isNumberArray(s.entries, n)) continue;
        const exits = isNumberArray(s.exits, n) ? s.exits : null;
        const flow = s.entries.map((e, i) => e + (exits ? exits[i] : 0));
        maxFlow = Math.max(maxFlow, ...flow);
        stationById.set(id, {
            id,
            name: typeof s.name === 'string' ? s.name : id,
            position: [s.lon, s.lat],
            flow
        });
    }

    const links: RushLink[] = [];
    let maxLoad = 1;
    for (const item of raw.links) {
        if (typeof item !== 'object' || item === null) continue;
        const l = item as Record<string, unknown>;
        if (typeof l.from !== 'string' || typeof l.to !== 'string') continue;
        const a = stationById.get(l.from);
        const b = stationById.get(l.to);
        if (!a || !b || !isNumberArray(l.load, n)) continue;
        maxLoad = Math.max(maxLoad, ...l.load);
        links.push({
            id: `${l.from}>${l.to}>${String(l.line)}`,
            from: a.id,
            to: b.id,
            fromName: a.name,
            toName: b.name,
            line: typeof l.line === 'string' ? l.line : '',
            source: a.position,
            target: b.position,
            walk: typeof l.walk === 'number' ? l.walk : null,
            load: l.load
        });
    }

    return { slices, stations: [...stationById.values()], links, maxFlow, maxLoad };
}

export function sliceLabel(data: RushData | null, slice: number) {
    // "0830-0845" -> "08:30"
    const raw = data?.slices[slice] ?? defaultSliceLabel(slice);
    return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
}

function defaultSliceLabel(slice: number) {
    const minutes = (5 * 60 + slice * 15) % (24 * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${hh}${mm}`;
}

export function walkableHighlights(data: RushData, slice: number) {
    // Busiest walkable hops at this moment. Both directions of a hop are merged so the
    // label shows one pair, carrying the larger of the two loads.
    const byPair = new Map<string, { link: RushLink; load: number }>();
    for (const link of data.links) {
        if (link.walk === null || link.walk > WALKABLE_MAX_MINUTES) continue;
        const key = [link.from, link.to].sort().join('|');
        const load = link.load[slice];
        const current = byPair.get(key);
        if (!current || load > current.load) byPair.set(key, { link, load });
    }
    return [...byPair.values()].sort((a, b) => b.load - a.load).slice(0, ESCAPE_HIGHLIGHT_COUNT);
}

export function walkablePassengers(data: RushData, slice: number) {
    // Passengers riding walkable hops in this quarter hour (all lines, both directions).
    let total = 0;
    for (const link of data.links) {
        if (link.walk !== null && link.walk <= WALKABLE_MAX_MINUTES) total += link.load[slice];
    }
    return total;
}
