import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { CommentMark, removeCommentMark } from './commentMark';
import type { DocComment, NodeT, PresenceUser } from '../types';
import {
  getNode,
  patchNode,
  listComments,
  createComment,
  deleteComment,
} from '../api/projects';
import { getClientId } from '../api/client';
import { connectCollab, type CollabConnection } from '../realtime/ws';
import { useAuthStore } from '../store/authStore';

const SAVE_DEBOUNCE_MS = 600;

function parsePath(): { projectId: string; nodeId: string } | null {
  const m = window.location.pathname.match(/^\/doc\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return {
    projectId: decodeURIComponent(m[1]),
    nodeId: decodeURIComponent(m[2]),
  };
}

function initials(name: string): string {
  const trimmed = (name || '?').trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function Avatar({ name, color, size = 24 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="doc-avatar"
      title={name}
      style={{ background: color || '#6366f1', width: size, height: size, fontSize: size * 0.45 }}
    >
      {initials(name)}
    </span>
  );
}

export default function DocEditorPage() {
  const route = useMemo(parsePath, []);
  const user = useAuthStore((s) => s.user);
  const loadMe = useAuthStore((s) => s.loadMe);
  const ready = useAuthStore((s) => s.ready);

  const [node, setNode] = useState<NodeT | null>(null);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [peers, setPeers] = useState<Record<string, PresenceUser>>({});
  const [activeComment, setActiveComment] = useState<string | null>(null);

  // Pending comment composer: holds the freshly-applied mark id + quoted text
  // while the author types the comment body.
  const [draft, setDraft] = useState<{ commentId: string; quote: string } | null>(null);
  const [draftBody, setDraftBody] = useState('');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>('');
  const collabRef = useRef<CollabConnection | null>(null);

  // Hydrate the user from a persisted token if this tab opened cold.
  useEffect(() => {
    if (!user && !ready) void loadMe();
  }, [user, ready, loadMe]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CommentMark,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'doc-editor__prose' },
    },
    onUpdate: ({ editor }) => {
      scheduleSave(editor.getHTML());
    },
  });

  const doSave = useCallback(
    (html: string) => {
      if (!route) return;
      if (html === lastSaved.current) return;
      setSaveState('saving');
      patchNode(route.projectId, route.nodeId, { content: html }, { skipHistory: true })
        .then(() => {
          lastSaved.current = html;
          setSaveState('saved');
        })
        .catch(() => setSaveState('idle'));
    },
    [route],
  );

  const scheduleSave = useCallback(
    (html: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => doSave(html), SAVE_DEBOUNCE_MS);
    },
    [doSave],
  );

  const flushSave = useCallback(() => {
    if (!editor) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    doSave(editor.getHTML());
  }, [editor, doSave]);

  // Initial load: node content + existing comments.
  useEffect(() => {
    if (!route || !editor) return;
    let cancelled = false;
    void (async () => {
      try {
        const [n, cs] = await Promise.all([
          getNode(route.projectId, route.nodeId),
          listComments(route.projectId, route.nodeId),
        ]);
        if (cancelled) return;
        setNode(n);
        document.title = `${n.title || '文档'} · Brainstorm`;
        lastSaved.current = n.content || '';
        editor.commands.setContent(n.content || '', false);
        setComments(cs);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载文档失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route, editor]);

  // Real-time collaboration channel for this project room.
  useEffect(() => {
    if (!route || !editor) return;
    const selfId = getClientId();
    const conn = connectCollab(route.projectId, {
      onMessage: (msg) => {
        switch (msg.type) {
          case 'node.updated': {
            const n = msg.payload.node;
            if (n.id !== route.nodeId) return;
            if (msg.origin === selfId) return;
            // Last-write-wins: only fold in a remote body when we're not the one
            // actively editing, to avoid clobbering an in-flight keystroke.
            if (!editor.isFocused) {
              lastSaved.current = n.content || '';
              editor.commands.setContent(n.content || '', false);
            }
            setNode((prev) => (prev ? { ...prev, title: n.title, content: n.content } : prev));
            return;
          }
          case 'comment.created': {
            const c = msg.payload.comment;
            if (c.node_id !== route.nodeId) return;
            setComments((prev) =>
              prev.some((x) => x.comment_id === c.comment_id) ? prev : [...prev, c],
            );
            return;
          }
          case 'comment.deleted': {
            if (msg.payload.node_id !== route.nodeId) return;
            const cid = msg.payload.comment_id;
            setComments((prev) => prev.filter((x) => x.comment_id !== cid));
            removeCommentMark(editor, cid);
            return;
          }
          case 'presence.state': {
            const next: Record<string, PresenceUser> = {};
            for (const p of msg.payload.peers) next[p.clientId] = p.user;
            setPeers(next);
            return;
          }
          case 'presence.join': {
            if (!msg.origin) return;
            setPeers((prev) => ({ ...prev, [msg.origin]: msg.payload.user }));
            return;
          }
          case 'presence.leave': {
            if (!msg.origin) return;
            setPeers((prev) => {
              const next = { ...prev };
              delete next[msg.origin];
              return next;
            });
            return;
          }
          default:
            return;
        }
      },
    });
    collabRef.current = conn;
    return () => {
      conn.close();
      collabRef.current = null;
    };
  }, [route, editor]);

  // Persist any pending edit when the tab is hidden / closed.
  useEffect(() => {
    const onHide = () => flushSave();
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [flushSave]);

  const beginComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const quote = editor.state.doc.textBetween(from, to, ' ').trim();
    const commentId = crypto.randomUUID();
    editor.chain().focus().setComment(commentId).run();
    flushSave(); // persist the mark immediately so it survives a reload
    setDraft({ commentId, quote });
    setDraftBody('');
  }, [editor, flushSave]);

  const submitComment = useCallback(() => {
    if (!route || !draft) return;
    const body = draftBody.trim();
    if (!body) return;
    createComment(route.projectId, route.nodeId, {
      comment_id: draft.commentId,
      quote: draft.quote,
      body,
    })
      .then((c) => {
        setComments((prev) => [...prev, c]);
        setDraft(null);
        setDraftBody('');
      })
      .catch(() => setError('添加批注失败'));
  }, [route, draft, draftBody]);

  const cancelComment = useCallback(() => {
    if (editor && draft) removeCommentMark(editor, draft.commentId);
    flushSave();
    setDraft(null);
    setDraftBody('');
  }, [editor, draft, flushSave]);

  const removeComment = useCallback(
    (commentId: string) => {
      if (!route) return;
      if (editor) removeCommentMark(editor, commentId);
      flushSave();
      setComments((prev) => prev.filter((c) => c.comment_id !== commentId));
      deleteComment(route.projectId, route.nodeId, commentId).catch(() =>
        setError('删除批注失败'),
      );
    },
    [route, editor, flushSave],
  );

  const focusComment = useCallback(
    (commentId: string) => {
      setActiveComment(commentId);
      const el = document.querySelector(`.doc-comment[data-comment-id="${commentId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('doc-comment--flash');
        window.setTimeout(() => el.classList.remove('doc-comment--flash'), 1200);
      }
    },
    [],
  );

  if (!route) {
    return <div className="doc-editor__fallback">无效的文档地址</div>;
  }

  const peerList = Object.entries(peers);
  const hasSelection = editor ? !editor.state.selection.empty : false;

  return (
    <div className="doc-editor">
      <header className="doc-editor__topbar">
        <div className="doc-editor__title">{node?.title || '文档'}</div>
        <div className="doc-editor__status">
          {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : ''}
        </div>
        <div className="doc-editor__peers">
          {user && <Avatar name={user.display_name} color={user.color} />}
          {peerList.map(([cid, p]) => (
            <Avatar key={cid} name={p.display_name} color={p.color} />
          ))}
        </div>
      </header>

      {error && <div className="doc-editor__error">{error}</div>}

      <Toolbar editor={editor} onAddComment={beginComment} canComment={hasSelection} />

      <div className="doc-editor__main">
        <div className="doc-editor__canvas">
          <EditorContent editor={editor} className="doc-editor__content" />
        </div>

        <aside className="doc-comment-list" aria-label="批注">
          <div className="doc-comment-list__header">批注 ({comments.length})</div>

          {draft && (
            <div className="doc-comment-card doc-comment-card--draft">
              {draft.quote && <div className="doc-comment-card__quote">“{draft.quote}”</div>}
              <textarea
                className="doc-comment-card__input"
                autoFocus
                placeholder="写下你的批注…"
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment();
                  if (e.key === 'Escape') cancelComment();
                }}
              />
              <div className="doc-comment-card__actions">
                <button type="button" className="btn btn--ghost" onClick={cancelComment}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!draftBody.trim()}
                  onClick={submitComment}
                >
                  批注
                </button>
              </div>
            </div>
          )}

          {comments.length === 0 && !draft && (
            <div className="doc-comment-list__empty">
              选中正文文字后点击「批注」即可添加。
            </div>
          )}

          {comments.map((c) => (
            <div
              key={c.id}
              className={`doc-comment-card${
                activeComment === c.comment_id ? ' doc-comment-card--active' : ''
              }`}
              onClick={() => focusComment(c.comment_id)}
            >
              <div className="doc-comment-card__head">
                <Avatar name={c.author_name} color={c.author_color} size={22} />
                <span className="doc-comment-card__author">{c.author_name}</span>
                <span className="doc-comment-card__time">{formatTime(c.created_at)}</span>
                <button
                  type="button"
                  className="doc-comment-card__del"
                  title="删除批注"
                  aria-label="删除批注"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeComment(c.comment_id);
                  }}
                >
                  ×
                </button>
              </div>
              {c.quote && <div className="doc-comment-card__quote">“{c.quote}”</div>}
              <div className="doc-comment-card__body">{c.body}</div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

// ---- toolbar ----

interface ToolbarProps {
  editor: Editor | null;
  onAddComment: () => void;
  canComment: boolean;
}

function Toolbar({ editor, onAddComment, canComment }: ToolbarProps) {
  if (!editor) return null;

  const Btn = ({
    active,
    disabled,
    onClick,
    title,
    children,
  }: {
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      className={`doc-tool${active ? ' doc-tool--active' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return (
    <div className="doc-editor__toolbar" role="toolbar" aria-label="格式工具栏">
      <Btn title="撤销" onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
      <Btn title="重做" onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
      <span className="doc-tool__sep" />
      <Btn title="标题 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</Btn>
      <Btn title="标题 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Btn>
      <Btn title="标题 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Btn>
      <span className="doc-tool__sep" />
      <Btn title="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
      <Btn title="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Btn>
      <Btn title="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
      <Btn title="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
      <Btn title="高亮" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}>🖊</Btn>
      <Btn title="行内代码" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</Btn>
      <span className="doc-tool__sep" />
      <Btn title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•≣</Btn>
      <Btn title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.≣</Btn>
      <Btn title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</Btn>
      <Btn title="代码块" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{'{ }'}</Btn>
      <span className="doc-tool__sep" />
      <Btn title="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>⬅</Btn>
      <Btn title="居中" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>↔</Btn>
      <Btn title="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>➡</Btn>
      <span className="doc-tool__sep" />
      <Btn title="添加批注（先选中文字）" disabled={!canComment} onClick={onAddComment}>💬 批注</Btn>
    </div>
  );
}
