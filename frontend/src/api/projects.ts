import { http } from './client';
import type { Project, NodeT, EdgeT, GraphResponse, NodeData } from '../types';

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
): Promise<NodeT> {
  return http.post<NodeT>(`/projects/${projectId}/nodes`, body);
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
): Promise<NodeT> {
  return http.patch<NodeT>(`/projects/${projectId}/nodes/${nodeId}`, body);
}

export function deleteNode(projectId: string, nodeId: string): Promise<void> {
  return http.del(`/projects/${projectId}/nodes/${nodeId}`);
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
): Promise<EdgeT> {
  return http.post<EdgeT>(`/projects/${projectId}/edges`, body);
}

export function deleteEdge(projectId: string, edgeId: string): Promise<void> {
  return http.del(`/projects/${projectId}/edges/${edgeId}`);
}
