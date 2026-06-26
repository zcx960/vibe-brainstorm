import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GalleryImage, NodeT } from '../types';
import { getNode, patchNode, getGraph } from '../api/projects';
import { uploadMedia } from '../api/images';
import { getClientId } from '../api/client';
import { connectCollab } from '../realtime/ws';
import { useAuthStore } from '../store/authStore';

interface CanvasImage {
  id: string;
  url: string;
  title: string;
}

function parsePath(): { projectId: string; nodeId: string } | null {
  const m = window.location.pathname.match(/^\/gallery\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return {
    projectId: decodeURIComponent(m[1]),
    nodeId: decodeURIComponent(m[2]),
  };
}

export default function GalleryPage() {
  const route = useMemo(parsePath, []);
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const loadMe = useAuthStore((s) => s.loadMe);

  const [node, setNode] = useState<NodeT | null>(null);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [canvasImages, setCanvasImages] = useState<CanvasImage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<GalleryImage[]>([]);
  imagesRef.current = images;

  useEffect(() => {
    if (!user && !ready) void loadMe();
  }, [user, ready, loadMe]);

  // Initial load: gallery node + the project's canvas images (for the picker).
  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    void (async () => {
      try {
        const [n, graph] = await Promise.all([
          getNode(route.projectId, route.nodeId),
          getGraph(route.projectId),
        ]);
        if (cancelled) return;
        setNode(n);
        document.title = `${n.title || '图库'} · Brainstorm`;
        const list = Array.isArray(n.data?.images) ? (n.data.images as GalleryImage[]) : [];
        setImages(list);
        setCanvasImages(
          graph.nodes
            .filter((x) => x.data?.kind === 'image' && typeof x.data?.image_url === 'string')
            .map((x) => ({
              id: x.id,
              url: x.data.image_url as string,
              title: x.title || '图片',
            })),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载图库失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route]);

  // Live sync: fold in remote changes to this gallery node.
  useEffect(() => {
    if (!route) return;
    const selfId = getClientId();
    const conn = connectCollab(route.projectId, {
      onMessage: (msg) => {
        if (msg.type === 'node.updated') {
          const n = msg.payload.node;
          if (n.id !== route.nodeId || msg.origin === selfId) return;
          setImages(Array.isArray(n.data?.images) ? (n.data.images as GalleryImage[]) : []);
        }
      },
    });
    return () => conn.close();
  }, [route]);

  const persist = useCallback(
    (next: GalleryImage[]) => {
      setImages(next);
      if (!route) return;
      patchNode(route.projectId, route.nodeId, { data: { images: next } }, { skipHistory: true }).catch(
        () => setError('保存图库失败'),
      );
    },
    [route],
  );

  const addFromCanvas = useCallback(
    (img: CanvasImage) => {
      if (imagesRef.current.some((x) => x.url === img.url)) return;
      persist([
        ...imagesRef.current,
        { id: crypto.randomUUID(), url: img.url, caption: img.title, source: 'canvas' },
      ]);
    },
    [persist],
  );

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!route || !files || files.length === 0) return;
      setBusy(true);
      try {
        const added: GalleryImage[] = [];
        for (const file of Array.from(files)) {
          const url = await uploadMedia(route.projectId, file);
          added.push({ id: crypto.randomUUID(), url, source: 'upload' });
        }
        persist([...imagesRef.current, ...added]);
      } catch (e) {
        setError(e instanceof Error ? e.message : '上传失败');
      } finally {
        setBusy(false);
      }
    },
    [route, persist],
  );

  const removeImage = useCallback(
    (id: string) => {
      persist(imagesRef.current.filter((x) => x.id !== id));
    },
    [persist],
  );

  if (!route) return <div className="gallery-page__fallback">无效的图库地址</div>;

  const addedUrls = new Set(images.map((i) => i.url));

  return (
    <div className="gallery-page">
      <header className="gallery-page__topbar">
        <div className="gallery-page__title">🖼 {node?.title || '图库'}</div>
        <div className="gallery-page__count">{images.length} 张</div>
        <div className="gallery-page__actions">
          <button
            type="button"
            className={`btn${pickerOpen ? ' btn--active' : ''}`}
            onClick={() => setPickerOpen((v) => !v)}
          >
            从画布添加
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? '上传中…' : '上传图片'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              void handleUpload(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </header>

      {error && <div className="gallery-page__error">{error}</div>}

      {pickerOpen && (
        <div className="gallery-picker">
          <div className="gallery-picker__header">画布上的图片(点击添加)</div>
          {canvasImages.length === 0 ? (
            <div className="gallery-picker__empty">画布上还没有图片节点</div>
          ) : (
            <div className="gallery-picker__grid">
              {canvasImages.map((img) => {
                const added = addedUrls.has(img.url);
                return (
                  <button
                    key={img.id}
                    type="button"
                    className={`gallery-picker__item${added ? ' gallery-picker__item--added' : ''}`}
                    title={added ? '已添加' : `添加「${img.title}」`}
                    disabled={added}
                    onClick={() => addFromCanvas(img)}
                  >
                    <img src={img.url} alt={img.title} draggable={false} />
                    {added && <span className="gallery-picker__badge">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="gallery-page__main">
        {images.length === 0 ? (
          <div className="gallery-page__empty">
            图库还是空的。用右上角「从画布添加」或「上传图片」来添加图片。
          </div>
        ) : (
          <div className="gallery-grid">
            {images.map((img) => (
              <figure key={img.id} className="gallery-card">
                <img src={img.url} alt={img.caption || ''} draggable={false} />
                <button
                  type="button"
                  className="gallery-card__del"
                  title="移除"
                  aria-label="移除"
                  onClick={() => removeImage(img.id)}
                >
                  ×
                </button>
                <figcaption className="gallery-card__caption">
                  <span className={`gallery-card__src gallery-card__src--${img.source}`}>
                    {img.source === 'upload' ? '上传' : '画布'}
                  </span>
                  {img.caption && <span className="gallery-card__text">{img.caption}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
