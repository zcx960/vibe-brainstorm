// Live presence of *other* collaborators in the current project: who's online,
// where their cursor is, and which node they have selected.
//
// Peers are keyed by their `clientId` (the envelope `origin` on every presence
// frame). The server excludes the sender from presence broadcasts, so this map
// never contains the local client. It's wiped via `clear()` on disconnect or a
// project switch so stale peers from another room can't linger.
//
// All mutators are defensive: a malformed/partial frame must update what it can
// and never throw, since presence is best-effort and additive.

import { create } from 'zustand';
import type { PresenceUser } from '../types';

export interface Peer {
  user: PresenceUser;
  cursor?: { x: number; y: number };
  // The node this peer currently has selected, or null/undefined for none.
  selection?: string | null;
}

interface PresenceState {
  // clientId -> peer.
  peers: Record<string, Peer>;

  // Replace the whole roster (from a `presence.state` snapshot on join).
  setRoster: (peers: { clientId: string; user: PresenceUser }[]) => void;
  // A peer joined.
  addPeer: (clientId: string, user: PresenceUser) => void;
  // A peer left.
  removePeer: (clientId: string) => void;
  // Update a peer's cursor position (creating the peer if first seen).
  setCursor: (
    clientId: string,
    user: PresenceUser,
    x: number,
    y: number,
  ) => void;
  // Update which node a peer has selected (creating the peer if first seen).
  setSelection: (
    clientId: string,
    user: PresenceUser,
    nodeId: string | null,
  ) => void;
  // Drop all peers (disconnect / project switch).
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  peers: {},

  setRoster: (incoming) =>
    set(() => {
      const peers: Record<string, Peer> = {};
      if (Array.isArray(incoming)) {
        for (const entry of incoming) {
          if (entry && entry.clientId && entry.user) {
            peers[entry.clientId] = { user: entry.user };
          }
        }
      }
      return { peers };
    }),

  addPeer: (clientId, user) =>
    set((state) => {
      if (!clientId || !user) return state;
      // Preserve any cursor/selection we already have for this client.
      const existing = state.peers[clientId];
      return {
        peers: {
          ...state.peers,
          [clientId]: { ...existing, user },
        },
      };
    }),

  removePeer: (clientId) =>
    set((state) => {
      if (!clientId || !(clientId in state.peers)) return state;
      const peers = { ...state.peers };
      delete peers[clientId];
      return { peers };
    }),

  setCursor: (clientId, user, x, y) =>
    set((state) => {
      if (!clientId || typeof x !== 'number' || typeof y !== 'number') {
        return state;
      }
      const existing = state.peers[clientId];
      return {
        peers: {
          ...state.peers,
          [clientId]: {
            // Fall back to a prior user record if this frame omitted one.
            user: user ?? existing?.user,
            selection: existing?.selection,
            cursor: { x, y },
          },
        },
      };
    }),

  setSelection: (clientId, user, nodeId) =>
    set((state) => {
      if (!clientId) return state;
      const existing = state.peers[clientId];
      return {
        peers: {
          ...state.peers,
          [clientId]: {
            user: user ?? existing?.user,
            cursor: existing?.cursor,
            selection: nodeId ?? null,
          },
        },
      };
    }),

  clear: () => set({ peers: {} }),
}));

/**
 * Color of the first remote peer that currently has `nodeId` selected, or
 * undefined if no peer has it selected. Designed to be passed directly as a
 * zustand selector: `usePresenceStore(remoteSelectionColor(id))`. It returns a
 * primitive so the consuming component only re-renders when *its* highlight
 * actually changes.
 */
export function remoteSelectionColor(
  nodeId: string,
): (s: PresenceState) => string | undefined {
  return (s) => {
    for (const peer of Object.values(s.peers)) {
      if (peer.selection === nodeId) {
        return peer.user?.color || '#6366f1';
      }
    }
    return undefined;
  };
}
