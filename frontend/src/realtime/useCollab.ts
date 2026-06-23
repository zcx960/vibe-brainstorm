// React hook that binds the collab WebSocket for the active project to the
// graph/UI stores. It opens one connection per project (re-opening whenever the
// selected project changes) and applies inbound frames to the stores, skipping
// our own optimistic echoes and guarding against project-switch races.

import { useEffect } from 'react';
import { getClientId } from '../api/client';
import { connectCollab } from './ws';
import type { CollabMessage } from './ws';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { usePresenceStore } from '../store/presenceStore';

export function useCollab(projectId: string | null): void {
  useEffect(() => {
    if (!projectId) return;

    const selfId = getClientId();

    // Start from an empty roster: stale peers from a previously-connected
    // project (or a prior socket) must not linger across the switch.
    usePresenceStore.getState().clear();

    const conn = connectCollab(projectId, {
      onMessage: (msg: CollabMessage) => {
        // Presence comes only from OTHER clients (the server excludes the
        // sender), and is keyed by `origin`, so route it before the self-skip
        // that de-dupes our own optimistic graph echoes.
        if (msg.type.startsWith('presence.')) {
          dispatchPresence(msg);
          return;
        }
        // Ignore our own echoes — we already applied these optimistically.
        if (msg.origin === selfId) return;
        dispatch(projectId, msg);
      },
    });

    return () => {
      conn.close();
      // Tearing down (unmount or project switch): drop peers immediately so the
      // roster/cursors don't show ghosts until the next connection repopulates.
      usePresenceStore.getState().clear();
    };
  }, [projectId]);
}

// Apply one inbound presence frame to the presence store. `origin` is the
// sending client's id and is the key every peer is stored under.
function dispatchPresence(msg: CollabMessage): void {
  const presence = usePresenceStore.getState();

  switch (msg.type) {
    case 'presence.state':
      presence.setRoster(msg.payload.peers ?? []);
      return;
    case 'presence.join':
      presence.addPeer(msg.origin, msg.payload.user);
      return;
    case 'presence.leave':
      presence.removePeer(msg.origin);
      return;
    case 'presence.cursor':
      presence.setCursor(
        msg.origin,
        msg.payload.user,
        msg.payload.x,
        msg.payload.y,
      );
      return;
    case 'presence.select':
      presence.setSelection(msg.origin, msg.payload.user, msg.payload.nodeId);
      return;
  }
}

// Apply one inbound frame to the stores. `connectedProjectId` is the project the
// socket was opened for; graph mutations additionally re-check the *live* graph
// store projectId so a frame that arrives mid-switch can't bleed into a freshly
// loaded graph.
function dispatch(connectedProjectId: string, msg: CollabMessage): void {
  const graph = useGraphStore.getState();
  const ui = useUiStore.getState();

  switch (msg.type) {
    case 'node.created':
    case 'node.updated':
      if (graph.projectId !== connectedProjectId) return;
      graph.upsertNodeFromRemote(msg.payload.node);
      return;

    case 'node.deleted':
      if (graph.projectId !== connectedProjectId) return;
      graph.removeNode(msg.payload.node_id);
      return;

    case 'edge.created':
      if (graph.projectId !== connectedProjectId) return;
      graph.addEdge(msg.payload.edge);
      return;

    case 'edge.deleted':
      if (graph.projectId !== connectedProjectId) return;
      graph.removeEdge(msg.payload.edge_id);
      return;

    case 'graph.restored':
      if (graph.projectId !== connectedProjectId) return;
      graph.replaceGraph({
        nodes: msg.payload.nodes,
        edges: msg.payload.edges,
      });
      void graph.refreshHistoryStatus(connectedProjectId);
      return;

    case 'project.updated':
      // Project metadata lives in the UI store and is project-agnostic; apply
      // regardless of which graph is currently loaded.
      ui.upsertProject(msg.payload.project);
      return;

    case 'project.deleted': {
      const deletedId = msg.payload.project_id;
      if (ui.currentProjectId === deletedId) {
        ui.pushToast('info', '该项目已被删除');
        // Switch to another project if one remains, else clear the canvas.
        const next = ui.projects.find((p) => p.id !== deletedId);
        ui.removeProject(deletedId); // drops it and nulls currentProjectId
        if (next) {
          ui.setCurrentProject(next.id);
          void graph.load(next.id);
        } else {
          graph.clear();
        }
      } else {
        ui.removeProject(deletedId);
      }
      return;
    }
  }
}
