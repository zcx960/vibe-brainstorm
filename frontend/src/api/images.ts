import { API_BASE, authHeaders, UNAUTHORIZED_EVENT, TOKEN_KEY } from './client';
import type {
  ImageGenerateRequest,
  ImageHandlers,
  ImageStartEvent,
  ImageEvent,
  ImageErrorEvent,
  ImageDoneEvent,
  ImageFatalErrorEvent,
  ImageUploadRequest,
  ImageUploadResponse,
  NodeT,
  EdgeT,
} from '../types';

/**
 * Stream image generation over POST.
 *
 * Same SSE-over-POST machinery as `streamExpand`: EventSource only supports
 * GET, so we POST with fetch, read the response body as a stream, and parse SSE
 * frames by hand (frames split on a blank line; within a frame "event:" sets
 * the event name and "data:" lines are concatenated into a JSON payload).
 *
 * Returns an `abort()` you can call to cancel the request.
 */
export function streamImageGenerate(
  req: ImageGenerateRequest,
  handlers: ImageHandlers,
): { abort: () => void } {
  const controller = new AbortController();

  void run();

  async function run() {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/images/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        handlers.onError?.({ message: errMessage(err) });
      }
      return;
    }

    // Mirror the global 401 handling: drop the token and notify the app so it
    // falls back to the login screen.
    if (res.status === 401) {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }

    if (!res.ok || !res.body) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        /* ignore */
      }
      handlers.onError?.({
        message: text || `请求失败 (HTTP ${res.status})`,
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Normalise CRLF so frame splitting is consistent.
        buffer = buffer.replace(/\r\n/g, '\n');

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          dispatchFrame(frame, handlers);
        }
      }

      // Flush a trailing frame that wasn't terminated by a blank line.
      buffer += decoder.decode();
      buffer = buffer.replace(/\r\n/g, '\n').trim();
      if (buffer) dispatchFrame(buffer, handlers);
    } catch (err) {
      if (!controller.signal.aborted) {
        handlers.onError?.({ message: errMessage(err) });
      }
    } finally {
      reader.releaseLock();
    }
  }

  return { abort: () => controller.abort() };
}

export async function uploadImageNode(
  req: ImageUploadRequest,
): Promise<ImageUploadResponse> {
  const form = new FormData();
  form.set('project_id', req.project_id);
  if (req.parent_id) form.set('parent_id', req.parent_id);
  form.set('title', req.title);
  form.set('content', req.content ?? '');
  form.set('x', String(req.position.x));
  form.set('y', String(req.position.y));
  form.set('file', req.file);

  const res = await fetch(`${API_BASE}/images/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  if (res.status === 401) {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      void 0;
    }
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(uploadErrorMessage(res.status, text));
  }
  if (!text) {
    throw new Error('上传接口没有返回图片节点');
  }

  const payload: unknown = JSON.parse(text);
  if (!isImageUploadResponse(payload)) {
    throw new Error('上传接口返回了无效图片节点');
  }
  return payload;
}

function dispatchFrame(frame: string, handlers: ImageHandlers): void {
  const trimmed = frame.trim();
  if (!trimmed) return;

  let event = 'message';
  const dataLines: string[] = [];

  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue; // comment / heartbeat
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }

  if (dataLines.length === 0) return;

  const dataStr = dataLines.join('\n');
  let payload: unknown;
  try {
    payload = JSON.parse(dataStr);
  } catch {
    // Non-JSON data; only meaningful for error-ish frames.
    if (event === 'error') {
      handlers.onError?.({ message: dataStr });
    }
    return;
  }

  switch (event) {
    case 'start':
      handlers.onStart?.(payload as ImageStartEvent);
      break;
    case 'image':
      handlers.onImage?.(payload as ImageEvent);
      break;
    case 'image_error':
      handlers.onImageError?.(payload as ImageErrorEvent);
      break;
    case 'done':
      handlers.onDone?.(payload as ImageDoneEvent);
      break;
    case 'error':
      handlers.onError?.(payload as ImageFatalErrorEvent);
      break;
    default:
      // Unknown event type — ignore.
      break;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function uploadErrorMessage(status: number, text: string): string {
  if (!text) return `上传失败 (HTTP ${status})`;
  try {
    const payload: unknown = JSON.parse(text);
    if (isRecord(payload) && typeof payload.detail === 'string') {
      return payload.detail;
    }
  } catch {
    return text;
  }
  return text;
}

function isImageUploadResponse(value: unknown): value is ImageUploadResponse {
  if (!isRecord(value) || !isNode(value.node)) return false;
  return value.edge === null || value.edge === undefined || isEdge(value.edge);
}

function isNode(value: unknown): value is NodeT {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    (typeof value.parent_id === 'string' || value.parent_id === null) &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    isRecord(value.data) &&
    typeof value.created_at === 'string'
  );
}

function isEdge(value: unknown): value is EdgeT {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    typeof value.source_id === 'string' &&
    typeof value.target_id === 'string' &&
    isRecord(value.data)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
