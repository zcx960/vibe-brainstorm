// Shared domain types — these MUST match the backend API contract exactly.

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeData {
  position: NodePosition;
  color?: string;
  collapsed?: boolean;
  // Image nodes (generated via /api/images/generate) carry these.
  kind?: 'idea' | 'image' | 'document' | 'region' | 'gallery';
  image_url?: string;
  prompt?: string;
  reference_image_urls?: string[];
  // Region nodes (visual backboards for grouping) carry their box size.
  width?: number;
  height?: number;
  // Gallery nodes hold a curated list of images.
  images?: GalleryImage[];
  [k: string]: unknown;
}

// An image collected into a gallery node. `url` is a `/api/media/...` path,
// either picked from a canvas image node or uploaded directly to the gallery.
export interface GalleryImage {
  id: string;
  url: string;
  caption?: string;
  source: 'canvas' | 'upload';
}

// A collaborative annotation on a document node. `comment_id` matches the inline
// comment mark baked into the document content (`<span data-comment-id=...>`).
export interface DocComment {
  id: string;
  project_id: string;
  node_id: string;
  comment_id: string;
  author_id: string | null;
  author_name: string;
  author_color: string;
  quote: string;
  body: string;
  created_at: string;
}

export interface NodeT {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  content: string;
  data: NodeData;
  created_at: string;
}

export interface EdgeT {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  data: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  default_mode: string;
  created_at: string;
  updated_at: string;
  role?: 'owner' | 'editor';
}

// ---- Auth + sharing ----

export interface User {
  id: string;
  username: string;
  display_name: string;
  color: string;
}

// The identity carried on presence frames. A subset of `User` (no email):
// just enough to render a cursor pill / avatar for a remote collaborator.
export interface PresenceUser {
  id: string;
  display_name: string;
  color: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Member {
  user: User;
  role: 'owner' | 'editor';
}

export interface ShareInfo {
  token: string;
  url: string;
  role: 'editor';
}

export interface Provider {
  id: string;
  name: string;
  models: string[];
  image_models: string[];
  available: boolean;
}

export interface Mode {
  id: string;
  name: string;
  description: string;
}

export interface Defaults {
  provider: string;
  model: string;
}

export interface GraphResponse {
  nodes: NodeT[];
  edges: EdgeT[];
}

// ---- brainstorm/expand request + SSE event payloads ----

export type ContextStrategy = 'node' | 'ancestors' | 'full';

export interface ExpandRequest {
  project_id: string;
  node_id: string;
  mode: string;
  provider: string;
  model: string;
  count: number;
  instruction?: string;
  context_strategy?: ContextStrategy;
}

export interface ExpandStartEvent {
  expansion_id: string;
}

export interface ExpandIdeaEvent {
  index: number;
  node: NodeT;
}

export interface ExpandUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ExpandDoneEvent {
  expansion_id: string;
  node_ids: string[];
  edge_ids: string[];
  usage: ExpandUsage;
}

export interface ExpandErrorEvent {
  message: string;
}

export interface ExpandHandlers {
  onStart?: (e: ExpandStartEvent) => void;
  onIdea?: (e: ExpandIdeaEvent) => void;
  onDone?: (e: ExpandDoneEvent) => void;
  onError?: (e: ExpandErrorEvent) => void;
}

// ---- image generation request + SSE event payloads ----

export interface ImageGenerateRequest {
  project_id: string;
  node_id: string;
  provider: string;
  model: string;
  count: number;
  prompt?: string;
  size?: string;
}

export interface ImageStartEvent {
  count?: number;
  reference_count?: number;
}

export interface ImageEvent {
  index: number;
  node: NodeT;
  edge?: EdgeT;
}

export interface ImageErrorEvent {
  index: number;
  message: string;
}

export interface ImageDoneEvent {
  node_ids: string[];
  edge_ids?: string[];
  count_ok: number;
  count_failed: number;
}

export interface ImageFatalErrorEvent {
  message: string;
}

export interface ImageHandlers {
  onStart?: (e: ImageStartEvent) => void;
  onImage?: (e: ImageEvent) => void;
  onImageError?: (e: ImageErrorEvent) => void;
  onDone?: (e: ImageDoneEvent) => void;
  onError?: (e: ImageFatalErrorEvent) => void;
}

export interface ImageUploadRequest {
  project_id: string;
  parent_id?: string | null;
  title: string;
  content?: string;
  position: NodePosition;
  file: File;
}

export interface ImageUploadResponse {
  node: NodeT;
  edge?: EdgeT | null;
}
