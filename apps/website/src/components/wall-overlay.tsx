import {
    ESCAPE_HIGHLIGHT_COUNT,
    sliceLabel,
    walkableHighlights,
    walkablePassengers,
    WALKABLE_MAX_MINUTES,
    type RushData,
    type RushLink
} from '../lib/realtime/rush-data';
import type { RushScene } from '../lib/realtime/types';

// Story text (left of the map) and a live ranking (right of the map), laid out once in
// WALL pixels. Every screen renders the same layer, shifted so it shows only its own slice;
// that keeps text aligned across physical screens.
//
// Data Observatory: 16 x 4 screens of 1920 x 1080 = 30720 x 4320 px. Inner London fills
// roughly columns 6-10, so the panels use columns 1-5 (left) and 11-15 (right).
// Each text block sits inside one screen row so no line is cut by a bezel.

export const TILE_W = 1920;
export const TILE_H = 1080;
export const WALL_COLS = 16;
export const WALL_ROWS = 4;
const WALL_W = TILE_W * WALL_COLS;
const WALL_H = TILE_H * WALL_ROWS;

const LEFT_X = TILE_W * 1 + 160;
const LEFT_W = TILE_W * 4.5;
const RIGHT_X = TILE_W * 11 + 160;
const RIGHT_W = TILE_W * 4.6;
// Ranking uses screen rows 2-4, two items per row so each line can be primary-size text.
const RANK_PER_ROW = 2;
const RANK_COUNT = ESCAPE_HIGHLIGHT_COUNT; // 2 per screen row x 3 rows; matches the map labels
const ITEM_H = TILE_H / RANK_PER_ROW;

// Type scale, derived from screen height so it follows the DO's legibility rule:
// primary wall text must be at least 20% of one screen's height (~10 m viewing distance).
// Secondary text (explanations, units) supports the primary line and stays smaller on purpose.
export const TYPE = {
    display: Math.round(TILE_H * 0.83), // the clock
    primary: Math.round(TILE_H * 0.21), // 227 px: headings, stats, ranking rows
    secondary: Math.round(TILE_H * 0.13), // 140 px: notes, details, map labels
    caption: Math.round(TILE_H * 0.08) // 86 px: data attribution only
} as const;

const ACCENT: Record<RushScene, string> = {
    heartbeat: 'rgb(255,176,59)',
    crush: 'rgb(255,92,92)',
    escape: 'rgb(74,222,128)'
};

type RankItem = { key: string; name: string; detail: string; value: string; share: number };

type Props = {
    data: RushData | null;
    scene: RushScene;
    slice: number;
    loadFailed: boolean;
    // Placement of this window over the wall.
    mode:
        | { kind: 'tile'; c: number; r: number; scale: number }
        | { kind: 'preview'; top: number; scale: number };
};

export function WallOverlay({ data, scene, slice, loadFailed, mode }: Props) {
    const transform =
        mode.kind === 'tile'
            ? `translate(${-mode.c * TILE_W * mode.scale}px, ${-mode.r * TILE_H * mode.scale}px) scale(${mode.scale})`
            : `translate(0px, ${mode.top}px) scale(${mode.scale})`;
    const story = buildStory(data, scene, slice);
    const ranking = data ? buildRanking(data, scene, slice) : null;
    const accent = ACCENT[scene];
    const time = sliceLabel(data, slice);

    return (
        <div
            className="pointer-events-none absolute top-0 left-0 z-10 text-zinc-100 tabular-nums"
            style={{ width: WALL_W, height: WALL_H, transform, transformOrigin: '0 0' }}
        >
            {/* ---------- Left: the story ---------- */}
            <Block x={LEFT_X} y={300} w={LEFT_W}>
                <p
                    style={{
                        fontSize: TYPE.primary,
                        lineHeight: 1.1,
                        letterSpacing: '0.2em',
                        color: accent
                    }}
                    className="uppercase"
                >
                    {story.kicker}
                </p>
                <p style={{ fontSize: TYPE.secondary, marginTop: 40 }} className="text-zinc-400">
                    London's rush hour · a typical weekday
                </p>
            </Block>

            {/* Clock: the primary text, filling most of one screen row. */}
            <Block x={LEFT_X - 40} y={TILE_H + 60} w={LEFT_W}>
                <p style={{ fontSize: TYPE.display, lineHeight: 1.05, fontWeight: 600 }}>{time}</p>
            </Block>

            <Block x={LEFT_X} y={TILE_H * 2 + 100} w={LEFT_W}>
                <p style={{ fontSize: TYPE.primary, lineHeight: 1.12, fontWeight: 500 }}>
                    {story.title}
                </p>
            </Block>

            <Block x={LEFT_X} y={TILE_H * 3 + 100} w={LEFT_W}>
                {loadFailed ? (
                    <p style={{ fontSize: TYPE.secondary }} className="text-red-300">
                        rush.json not found — run scripts/build_data.py
                    </p>
                ) : (
                    <>
                        <p
                            style={{
                                fontSize: TYPE.primary,
                                lineHeight: 1.1,
                                color: accent,
                                fontWeight: 600
                            }}
                        >
                            {story.stat}
                        </p>
                        <p
                            style={{ fontSize: TYPE.secondary, marginTop: 40, lineHeight: 1.25 }}
                            className="text-zinc-400"
                        >
                            {story.note}
                        </p>
                    </>
                )}
            </Block>

            {/* ---------- Right: live ranking ---------- */}
            {ranking ? (
                <>
                    <Block x={RIGHT_X} y={300} w={RIGHT_W}>
                        <p style={{ fontSize: TYPE.primary, lineHeight: 1.1, fontWeight: 600 }}>
                            {ranking.heading}
                        </p>
                        <p
                            style={{ fontSize: TYPE.secondary, marginTop: 50 }}
                            className="text-zinc-400"
                        >
                            {ranking.subheading} · {time}–{endLabel(data, slice)}
                        </p>
                    </Block>
                    {ranking.items.map((item, i) => {
                        const row = 1 + Math.floor(i / RANK_PER_ROW);
                        const y = row * TILE_H + (i % RANK_PER_ROW) * ITEM_H + 50;
                        return (
                            <div
                                key={item.key}
                                className="absolute flex items-start"
                                style={{
                                    left: RIGHT_X,
                                    top: y,
                                    width: RIGHT_W,
                                    height: ITEM_H - 60
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: TYPE.primary,
                                        lineHeight: 1.1,
                                        width: 420,
                                        color: accent,
                                        fontWeight: 600
                                    }}
                                >
                                    {i + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between gap-[120px]">
                                        <span
                                            className="truncate"
                                            style={{
                                                fontSize: TYPE.primary,
                                                lineHeight: 1.1,
                                                fontWeight: 500
                                            }}
                                        >
                                            {item.name}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: TYPE.primary,
                                                lineHeight: 1.1,
                                                fontWeight: 600,
                                                color: accent
                                            }}
                                        >
                                            {item.value}
                                        </span>
                                    </div>
                                    <div
                                        className="flex items-center gap-[60px]"
                                        style={{ marginTop: 30 }}
                                    >
                                        {/* Bar length = share of the #1 item, for at-a-glance comparison. */}
                                        <div
                                            style={{
                                                height: 36,
                                                width: `${Math.max(2, item.share * 45)}%`,
                                                background: accent,
                                                opacity: 0.55,
                                                borderRadius: 18
                                            }}
                                        />
                                        <span
                                            style={{ fontSize: TYPE.secondary }}
                                            className="truncate text-zinc-400"
                                        >
                                            {item.detail}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </>
            ) : null}

            {/* Attribution once, bottom-left under the story (the ranking fills the right). */}
            <p
                className="absolute text-zinc-500"
                style={{ left: LEFT_X, bottom: 100, fontSize: TYPE.caption }}
            >
                Data: TfL NUMBAT 2025 (typical Tue–Thu) · TfL walking times between stations · Map ©
                CARTO, © OpenStreetMap contributors
            </p>
        </div>
    );
}

function Block({
    x,
    y,
    w,
    children
}: {
    x: number;
    y: number;
    w: number;
    children: React.ReactNode;
}) {
    return (
        <div className="absolute" style={{ left: x, top: y, width: w }}>
            {children}
        </div>
    );
}

function buildStory(data: RushData | null, scene: RushScene, slice: number) {
    if (!data) {
        return { kicker: 'Just walk, London', title: 'Loading TfL data…', stat: '', note: '' };
    }
    if (scene === 'heartbeat') {
        const total = data.stations.reduce((sum, s) => sum + s.flow[slice], 0);
        return {
            kicker: '1 · The heartbeat',
            title: 'Every Tube, Overground, DLR and Elizabeth line station in Zones 1–3',
            stat: `${fmt(total)} people in or out`,
            note: 'Circle size = people entering + leaving each station in these 15 minutes.'
        };
    }
    if (scene === 'crush') {
        let peak = 0;
        for (const l of data.links) peak = Math.max(peak, l.load[slice]);
        return {
            kicker: '2 · The crush',
            title: 'How many people are on the trains between each pair of stations',
            stat: `Up to ${fmt(peak)} people on a single hop`,
            note: 'Thicker and redder = more passengers travelling between neighbouring stations.'
        };
    }
    return {
        kicker: '3 · Just walk',
        title: `Busy hops that take ${WALKABLE_MAX_MINUTES} minutes or less on foot`,
        stat: `${fmt(walkablePassengers(data, slice))} rides on walkable hops`,
        note: 'Green = TfL says you could walk it in 10 min or less. Rides are counted per hop.'
    };
}

function buildRanking(data: RushData, scene: RushScene, slice: number) {
    let items: RankItem[];
    if (scene === 'heartbeat') {
        const top = [...data.stations]
            .sort((a, b) => b.flow[slice] - a.flow[slice])
            .slice(0, RANK_COUNT);
        const max = top[0]?.flow[slice] || 1;
        items = top.map((s) => ({
            key: s.id,
            name: shortName(s.name),
            detail: '',
            value: fmt(s.flow[slice]),
            share: s.flow[slice] / max
        }));
        return { heading: 'Busiest stations', subheading: 'people entering + leaving', items };
    }
    if (scene === 'crush') {
        const top = [...data.links]
            .sort((a, b) => b.load[slice] - a.load[slice])
            .slice(0, RANK_COUNT);
        const max = top[0]?.load[slice] || 1;
        items = top.map((l) => ({
            key: l.id,
            name: hopName(l),
            detail: lineLabel(l.line),
            value: fmt(l.load[slice]),
            share: l.load[slice] / max
        }));
        return { heading: 'Most crowded hops', subheading: 'passengers on board', items };
    }
    const top = walkableHighlights(data, slice).slice(0, RANK_COUNT);
    const max = top[0]?.load || 1;
    items = top.map(({ link, load }) => ({
        key: link.id,
        name: hopName(link),
        detail: `${fmt(load)} riders · ${lineLabel(link.line)}`,
        value: `${link.walk} min`,
        share: load / max
    }));
    return { heading: 'Walk it instead', subheading: 'busiest hops ≤10 min on foot', items };
}

function lineLabel(line: string) {
    // NUMBAT names some lines "Elizabeth Line"; avoid "Elizabeth Line line".
    return /line$/i.test(line) ? line : `${line} line`;
}

function hopName(l: RushLink) {
    return `${shortName(l.fromName)} → ${shortName(l.toName)}`;
}

function shortName(name: string) {
    return name.replace(/\s+(LU|NR|DLR|LO|EL|TfL)$/, '');
}

function endLabel(data: RushData | null, slice: number) {
    return sliceLabel(data, (slice + 1) % 96);
}

function fmt(value: number) {
    return Math.round(value).toLocaleString('en-GB');
}
