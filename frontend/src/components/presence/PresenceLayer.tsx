// Live remote-cursor layer for the canvas. Two jobs:
//
//   1. SEND our own pointer position. We listen for `pointermove` on the React
//      Flow pane, convert screen -> flow coordinates, throttle, and emit a
//      `presence.cursor` frame over the collab socket.
//
//   2. RENDER other people's cursors. For every peer that has a cursor we
//      project its flow coordinates back to screen space via
//      `flowToScreenPosition` and draw a pointer + name pill in the peer's
//      colour. Subscribing to the viewport makes the projection re-run on every
//      pan/zoom so remote cursors stay pinned to the right spot in flow space.
//
// Mounted INSIDE <ReactFlowProvider> (next to <Canvas>) so the React Flow
// coordinate helpers are available. The overlay itself is pointer-events:none
// and absolutely positioned over the canvas, so it never intercepts input.

import { useEffect, useMemo, useRef } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { usePresenceStore } from '../../store/presenceStore';
import { sendPresence } from '../../realtime/ws';

// Cursor send cadence. ~40ms ≈ 25 frames/sec — smooth enough to follow without
// flooding the socket.
const CURSOR_THROTTLE_MS = 40;

export function PresenceLayer() {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  // Re-render whenever the viewport changes so projected cursors track pan/zoom.
  const viewport = useViewport();

  const overlayRef = useRef<HTMLDivElement>(null);

  // Subscribe to peers. Selecting the map is fine: presence updates are the only
  // thing that mutate it, and that's exactly when we want to re-render.
  const peers = usePresenceStore((s) => s.peers);

  // ---- send our cursor ----
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    // The React Flow pane lives in the same canvas container as this overlay.
    const root = overlay.closest('.app__canvas') ?? overlay.parentElement;
    const pane =
      (root?.querySelector('.react-flow__pane') as HTMLElement | null) ??
      (root?.querySelector('.react-flow') as HTMLElement | null);
    if (!pane) return;

    let last = 0;
    const onPointerMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - last < CURSOR_THROTTLE_MS) return;
      last = now;
      // Screen -> flow so the position is viewport-independent on the wire.
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      sendPresence({ type: 'presence.cursor', x: flow.x, y: flow.y });
    };

    pane.addEventListener('pointermove', onPointerMove);
    return () => pane.removeEventListener('pointermove', onPointerMove);
  }, [screenToFlowPosition]);

  // ---- project peer cursors to overlay-local coordinates ----
  // flowToScreenPosition returns viewport(client)-relative px; the overlay is
  // absolutely positioned, so subtract its top-left to get local offsets.
  // `viewport` is referenced so this recomputes on pan/zoom.
  const cursors = useMemo(() => {
    void viewport; // re-run on viewport change
    const rect = overlayRef.current?.getBoundingClientRect();
    const offsetX = rect?.left ?? 0;
    const offsetY = rect?.top ?? 0;

    return Object.entries(peers)
      .filter(([, peer]) => peer.cursor && peer.user)
      .map(([clientId, peer]) => {
        const screen = flowToScreenPosition(peer.cursor!);
        return {
          clientId,
          x: screen.x - offsetX,
          y: screen.y - offsetY,
          color: peer.user.color || '#6366f1',
          name: peer.user.display_name || '协作者',
        };
      });
  }, [peers, flowToScreenPosition, viewport]);

  return (
    <div ref={overlayRef} className="presence-overlay" aria-hidden>
      {cursors.map((c) => (
        <div
          key={c.clientId}
          className="presence-cursor"
          style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
        >
          <svg
            className="presence-cursor__pointer"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
          >
            <path
              d="M2 2 L2 13.5 L5.4 10.3 L7.7 15.6 L10 14.6 L7.7 9.4 L12.4 9.4 Z"
              fill={c.color}
              stroke="#fff"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="presence-cursor__label"
            style={{ background: c.color }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
}
