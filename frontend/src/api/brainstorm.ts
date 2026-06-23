import { API_BASE, authHeaders, UNAUTHORIZED_EVENT, TOKEN_KEY } from './client';
import type {
  ExpandRequest,
  ExpandHandlers,
  ExpandStartEvent,
  ExpandIdeaEvent,
  ExpandDoneEvent,
  ExpandErrorEvent,
} from '../types';

/**
 * Stream the brainstorm expansion over POST.
 *
 * EventSource only supports GET, so we POST with fetch, read the response body
 * as a stream, and parse SSE frames by hand:
 *
 *   - The stream is decoded incrementally into a text buffer.
 *   - SSE frames are separated by a blank line ("\n\n"). We split the buffer on
 *     "\n\n"; everything before the last separator is a set of complete frames,
 *     and the trailing piece is kept as `buffer` until more bytes arrive.
 *   - Within a frame, lines beginning "event:" set the event name and lines
 *     beginning "data:" are concatenated (newline-joined) to form the payload,
 *     which we JSON.parse.
 *   - On stream end we flush any final, separator-less frame.
 *
 * Returns an `abort()` you can call to cancel the request.
 */
export function streamExpand(
  req: ExpandRequest,
  handlers: ExpandHandlers,
): { abort: () => void } {
  const controller = new AbortController();

  void run();

  async function run() {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/brainstorm/expand`, {
        method: 'POST',
        // Same auth + per-tab identity as the `request` choke point. This
        // endpoint streams via fetch, so it can't go through `request`; we
        // reuse authHeaders() to keep header construction in one place.
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

function dispatchFrame(frame: string, handlers: ExpandHandlers): void {
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
      handlers.onStart?.(payload as ExpandStartEvent);
      break;
    case 'idea':
      handlers.onIdea?.(payload as ExpandIdeaEvent);
      break;
    case 'done':
      handlers.onDone?.(payload as ExpandDoneEvent);
      break;
    case 'error':
      handlers.onError?.(payload as ExpandErrorEvent);
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
