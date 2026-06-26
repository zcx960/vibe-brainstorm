import { API_BASE, authHeaders, http } from './client';
import type {
  Project,
  NodeT,
  EdgeT,
  GraphResponse,
  NodeData,
  DocComment,
} from '../types';

// ---- Projects ----

export function listProjects(): Promise<Project[]> {
  return http
    .get<{ projects: Project[] }>('/projects')
    .then((r) => r.projects);
}

export function createProject(
  name: string,
  defaultMode?: string,
): Promise<Project> {
  return http.post<Project>('/projects', {
    name,
    ...(defaultMode ? { default_mode: defaultMode } : {}),
  });
}

export function getProject(id: string): Promise<Project> {
  return http.get<Project>(`/projects/${id}`);
}

export function patchProject(
  id: string,
  patch: { name?: string; default_mode?: string },
): Promise<Project> {
  return http.patch<Project>(`/projects/${id}`, patch);
}

export function deleteProject(id: string): Promise<void> {
  return http.del(`/projects/${id}`);
}

// ---- Graph ----

export function getGraph(projectId: string): Promise<GraphResponse> {
  return http.get<GraphResponse>(`/projects/${projectId}/graph`);
}

// ---- Nodes ----

export interface CreateNodeBody {
  parent_id?: string | null;
  title: string;
  content?: string;
  data?: Partial<NodeData>;
}

export function createNode(
  projectId: string,
  body: CreateNodeBody,
  options?: { skipHistory?: boolean },
): Promise<NodeT> {
  return http.post<NodeT>(
    `/projects/${projectId}/nodes`,
    body,
    historyHeaders(options),
  );
}

export interface PatchNodeBody {
  title?: string;
  content?: string;
  data?: Partial<NodeData>;
  parent_id?: string | null;
}

export function patchNode(
  projectId: string,
  nodeId: string,
  body: PatchNodeBody,
  options?: { skipHistory?: boolean },
): Promise<NodeT> {
  return http.patch<NodeT>(
    `/projects/${projectId}/nodes/${nodeId}`,
    body,
    historyHeaders(options),
  );
}

export function deleteNode(
  projectId: string,
  nodeId: string,
  options?: { skipHistory?: boolean },
): Promise<void> {
  return http.del(
    `/projects/${projectId}/nodes/${nodeId}`,
    historyHeaders(options),
  );
}

export function getNode(projectId: string, nodeId: string): Promise<NodeT> {
  return http.get<NodeT>(`/projects/${projectId}/nodes/${nodeId}`);
}

// ---- Document comments ----

export function listComments(
  projectId: string,
  nodeId: string,
): Promise<DocComment[]> {
  return http.get<DocComment[]>(
    `/projects/${projectId}/nodes/${nodeId}/comments`,
  );
}

export interface CreateCommentBody {
  comment_id: string;
  quote?: string;
  body: string;
}

export function createComment(
  projectId: string,
  nodeId: string,
  body: CreateCommentBody,
): Promise<DocComment> {
  return http.post<DocComment>(
    `/projects/${projectId}/nodes/${nodeId}/comments`,
    body,
  );
}

export function deleteComment(
  projectId: string,
  nodeId: string,
  commentId: string,
): Promise<void> {
  return http.del(
    `/projects/${projectId}/nodes/${nodeId}/comments/${commentId}`,
  );
}

// ---- Edges ----

export interface CreateEdgeBody {
  source_id: string;
  target_id: string;
  data?: Record<string, unknown>;
}

export function createEdge(
  projectId: string,
  body: CreateEdgeBody,
  options?: { skipHistory?: boolean },
): Promise<EdgeT> {
  return http.post<EdgeT>(
    `/projects/${projectId}/edges`,
    body,
    historyHeaders(options),
  );
}

export function deleteEdge(
  projectId: string,
  edgeId: string,
  options?: { skipHistory?: boolean },
): Promise<void> {
  return http.del(
    `/projects/${projectId}/edges/${edgeId}`,
    historyHeaders(options),
  );
}

// ---- History ----

export interface HistoryStatus {
  can_undo: boolean;
  count: number;
}

export function getHistoryStatus(projectId: string): Promise<HistoryStatus> {
  return http.get<HistoryStatus>(`/projects/${projectId}/history`);
}

export function undoProjectHistory(projectId: string): Promise<GraphResponse> {
  return http.post<GraphResponse>(`/projects/${projectId}/history/undo`);
}

export interface HistoryEntry {
  id: string;
  action: string;
  created_at: string;
}

export function listHistory(projectId: string): Promise<HistoryEntry[]> {
  return http
    .get<{ entries: HistoryEntry[] }>(`/projects/${projectId}/history/list`)
    .then((r) => r.entries);
}

export function restoreHistory(
  projectId: string,
  historyId: string,
): Promise<GraphResponse> {
  return http.post<GraphResponse>(
    `/projects/${projectId}/history/restore/${historyId}`,
  );
}

export function beginHistoryBatch(projectId: string): Promise<void> {
  return http.post<void>(`/projects/${projectId}/history/begin`);
}

export function exportProjectDocx(projectId: string): Promise<Blob> {
  return fetch(`${API_BASE}/projects/${projectId}/export.docx`, {
    headers: authHeaders(),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`export failed: ${res.status}`);
    return res.blob();
  });
}

function historyHeaders(
  options?: { skipHistory?: boolean },
): Record<string, string> | undefined {
  return options?.skipHistory ? { 'X-Skip-History': '1' } : undefined;
}
