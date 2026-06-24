// Real-time collaboration WebSocket client.
//
// `connectCollab` opens a single WebSocket to the per-project collab channel and
// pumps decoded server frames into a caller-supplied `onMessage` handler. It owns
// reconnection (capped exponential backoff) and a keep-alive ping, and hands back
// a `close()` that tears everything down without triggering a reconnect.
//
// The server frame contract is an envelope `{ type, origin, payload }` where
// `origin` is the acting client's id. Callers de-dupe their own optimistic echoes
// by comparing `origin` against `getClientId()`.

import { getClientId, TOKEN_KEY } from '../api/client';
import type { NodeT, EdgeT, Project, PresenceUser } from '../types';

// ---- server -> client message envelope ----

export type CollabMessage =
  | { type: 'node.created'; origin: string; payload: { node: NodeT } }
  | { type: 'node.updated'; origin: string; payload: { node: NodeT } }
  | { type: 'node.deleted'; origin: string; payload: { node_id: string } }
  | { type: 'edge.created'; origin: string; payload: { edge: EdgeT } }
  | { type: 'edge.deleted'; origin: string; payload: { edge_id: string } }
  | { type: 'graph.restored'; origin: string; payload: { nodes: NodeT[]; edges: EdgeT[] } }
  | { type: 'project.updated'; origin: string; payload: { project: Project } }
  | { type: 'project.deleted'; origin: string; payload: { project_id: string } }
  // ---- presence (from OTHER clients; the server excludes the sender) ----
  | {
      // Server-authored roster snapshot sent to a newcomer; has a null origin.
      type: 'presence.state';
      origin: string | null;
      payload: { peers: { clientId: string; user: PresenceUser }[] };
    }
  | { type: 'presence.join'; origin: string; payload: { user: PresenceUser } }
  | { type: 'presence.leave'; origin: string; payload: Record<string, never> }
  | {
      type: 'presence.cursor';
      origin: string;
      payload: { user: PresenceUser; x: number; y: number };
    }
  | {
      type: 'presence.select';
      origin: string;
      payload: { user: PresenceUser; nodeId: string | null };
    };

export interface CollabHandlers {
  onMessage: (msg: CollabMessage) => void;
}

export interface CollabConnection {
  close: () => void;
}

// ---- outgoing presence channel ----
//
// A module-level reference to the currently-open collab socket. Presence is
// fire-and-forget and ephemeral (cursor moves, selection), so it bypasses the
// reconnect/queue machinery: if the socket is open we send, otherwise it's a
// no-op. The reference is set on `onopen` and cleared whenever the socket goes
// away (close or replacement), so a send can never target a dead socket.
let activeSocket: WebSocket | null = null;

/**
 * Send an arbitrary presence frame (e.g. `{ type:'presence.cursor', x, y }`)
 * over the live collab socket. No-op if the socket isn't currently OPEN.
 */
export function sendPresence(msg: object): void {
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    try {
      activeSocket.send(JSON.stringify(msg));
    } catch {
      /* ignore transient send failures */
    }
  }
}

// Backoff schedule for reconnects: 1s, 2s, 4s, 8s, capped at 15s.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 15000;
// Application-level keep-alive cadence (server may also send its own pings).
const PING_INTERVAL_MS = 25000;

function buildUrl(projectId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let token = '';
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    /* localStorage unavailable (privacy mode) — connect without it */
  }
  return (
    `${proto}//${location.host}/api/ws/projects/${projectId}` +
    `?token=${encodeURIComponent(token)}` +
    `&clientId=${encodeURIComponent(getClientId())}`
  );
}

export function connectCollab(
  projectId: string,
  handlers: CollabHandlers,
): CollabConnection {
  // Set once `close()` is called so neither the socket's `onclose` nor any
  // pending backoff timer revives the connection.
  let closed = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearPing = () => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(
      BACKOFF_BASE_MS * 2 ** attempt,
      BACKOFF_MAX_MS,
    );
    attempt += 1;
    clearReconnect();
    reconnectTimer = setTimeout(open, delay);
  };

  function open() {
    if (closed) return;
    clearReconnect();

    let ws: WebSocket;
    try {
      ws = new WebSocket(buildUrl(projectId));
    } catch {
      // Construction can throw on malformed URLs / blocked schemes — back off
      // and retry rather than giving up the channel entirely.
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (closed) {
        // Raced with close(): drop this socket immediately.
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }
      // Successful connection resets the backoff window.
      attempt = 0;
      // Expose this socket for outgoing presence sends.
      activeSocket = ws;
      clearPing();
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'ping' }));
          } catch {
            /* ignore transient send failures */
          }
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      if (closed) return;
      let msg: unknown;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return; // ignore non-JSON / heartbeat frames
      }
      if (!isCollabMessage(msg)) return;
      handlers.onMessage(msg);
    };

    ws.onerror = () => {
      // Surfaced as a close shortly after; nothing actionable here.
    };

    ws.onclose = () => {
      clearPing();
      if (socket === ws) socket = null;
      // Stop routing presence sends to a socket that's gone.
      if (activeSocket === ws) activeSocket = null;
      if (closed) return;
      scheduleReconnect();
    };
  }

  open();

  return {
    close() {
      closed = true;
      clearReconnect();
      clearPing();
      if (socket) {
        // This socket is going away; stop routing presence sends to it.
        if (activeSocket === socket) activeSocket = null;
        // Detach handlers so the imminent onclose can't schedule a reconnect.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        socket = null;
      }
    },
  };
}

// Narrow an arbitrary parsed frame to a CollabMessage. Anything we don't
// recognize (e.g. a server `pong`) is dropped by the caller.
function isCollabMessage(value: unknown): value is CollabMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string') return false;
  // `origin` is a client-id string on every frame except `presence.state`,
  // whose origin is null (a server-authored roster snapshot). Allow both.
  if (typeof v.origin !== 'string' && v.origin !== null) return false;
  switch (v.type) {
    case 'node.created':
    case 'node.updated':
    case 'node.deleted':
    case 'edge.created':
    case 'edge.deleted':
    case 'graph.restored':
    case 'project.updated':
    case 'project.deleted':
    case 'presence.state':
    case 'presence.join':
    case 'presence.leave':
    case 'presence.cursor':
    case 'presence.select':
      // Presence payloads are validated defensively at the dispatch site so a
      // frame missing optional fields is tolerated rather than dropped here.
      return typeof v.payload === 'object' && v.payload !== null;
    default:
      return false;
  }
}
