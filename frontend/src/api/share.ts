import { http } from './client';
import type { Project, Member, ShareInfo } from '../types';

// POST /api/projects/{id}/share (owner) -> {token, url, role:"editor"}.
export function shareProject(projectId: string): Promise<ShareInfo> {
  return http.post<ShareInfo>(`/projects/${projectId}/share`);
}

// POST /api/share/{token}/accept -> the joined project.
// The backend returns the Project object directly; tolerate a {project}
// wrapper too so either shape works.
export function acceptShare(token: string): Promise<Project> {
  return http
    .post<Project & { project?: Project }>(`/share/${token}/accept`)
    .then((r) => r.project ?? r);
}

// GET /api/projects/{id}/members -> {members:[{user, role}]}.
export function listMembers(projectId: string): Promise<Member[]> {
  return http
    .get<{ members: Member[] }>(`/projects/${projectId}/members`)
    .then((r) => r.members);
}

// DELETE /api/projects/{id}/members/{userId} -> 204.
export function removeMember(
  projectId: string,
  userId: string,
): Promise<void> {
  return http.del(`/projects/${projectId}/members/${userId}`);
}
