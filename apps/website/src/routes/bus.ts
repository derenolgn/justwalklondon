import { createFileRoute } from '@tanstack/react-router';
import { defineHooks } from 'crossws';

import type {
    BusMessage,
    BusSharedState,
    ScreenMapViewMessage,
    ScreenRushMessage
} from '../lib/realtime';
import { DEFAULT_RUSH_SLICE, isRushScene, sanitizeSlice } from '../lib/realtime/types';

// In-memory bus state for this server process.
// New clients receive this snapshot in the `hello` handshake so they can
// join late without waiting for another control interaction.
const busSharedState: BusSharedState = {
    zoom: 13,
    slice: DEFAULT_RUSH_SLICE,
    scene: 'heartbeat'
};

const hooks = defineHooks({
    open(peer) {
        // `hello` is our bootstrap packet:
        // it communicates peer identity + current collaborative state.
        peer.send({
            type: 'hello',
            peerId: peer.id,
            state: busSharedState
        });

        // All collaborating clients publish/subscribe on one logical channel (`do`).
        // This keeps the demo simple while still showing fan-out semantics.
        peer.subscribe('do');
        peer.publish('do', {
            type: 'peer',
            peerId: peer.id,
            peerCount: peer.peers.size
        });
    },
    message(peer, message) {
        // Ignore malformed payloads; only valid JSON objects enter the shared-state path.
        let payload: Partial<BusMessage>;
        try {
            const parsed = message.json() as unknown;
            if (typeof parsed !== 'object' || parsed === null) return;
            payload = parsed as Partial<BusMessage>;
        } catch {
            return;
        }
        updateBusSharedState(payload);

        // Broadcast to all peers. Each client engine can ignore own echoes via peerId.
        peer.publish('do', {
            ...payload,
            peerId: peer.id,
            peerCount: peer.peers.size
        });
    },
    close(peer) {
        peer.publish('do', {
            type: 'bye',
            peerId: peer.id,
            peerCount: peer.peers.size
        });
        peer.unsubscribe('do');
    }
});

function updateBusSharedState(payload: Partial<BusMessage>) {
    if (payload.type === 'screen/rush') {
        // Remember time-of-day + scene so late-joining screens open on the same moment.
        const message = payload as Partial<ScreenRushMessage>;
        const slice = sanitizeSlice(message.slice);
        if (slice !== null) busSharedState.slice = slice;
        if (isRushScene(message.scene)) busSharedState.scene = message.scene;
        return;
    }

    if (payload.type === 'screen/map-view') {
        const message = payload as Partial<ScreenMapViewMessage>;
        // Preserve last known valid zoom for hello-state replay.
        const zoom = message.view?.zoom;
        if (typeof zoom === 'number' && Number.isFinite(zoom)) {
            busSharedState.zoom = zoom;
        }
    }
}

export const Route = createFileRoute('/bus')({
    server: {
        handlers: {
            GET: async () => {
                // HTTP fallback response: this endpoint is a websocket upgrade target.
                return Object.assign(
                    new Response('WebSocket upgrade is required.', {
                        status: 426
                    }),
                    {
                        crossws: hooks
                    }
                );
            }
        }
    }
});
