import { useEffect, useMemo, useState } from 'react';
import { patchNode } from '../api/projects';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

export function NodePreviewPanel() {
  const previewNodeId = useUiStore((s) => s.previewNodeId);
  const closeNodePreview = useUiStore((s) => s.closeNodePreview);
  const pushToast = useUiStore((s) => s.pushToast);

  const projectId = useGraphStore((s) => s.projectId);
  const nodes = useGraphStore((s) => s.rfNodes);
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const refreshHistoryStatus = useGraphStore((s) => s.refreshHistoryStatus);

  const node = useMemo(
    () => nodes.find((item) => item.id === previewNodeId),
    [nodes, previewNodeId],
  );
  const parent = useMemo(
    () => nodes.find((item) => item.id === node?.data.parentId),
    [nodes, node?.data.parentId],
  );

  const [titleDraft, setTitleDraft] = useState('');
  const [contentDraft, setContentDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!node) return;
    setTitleDraft(node.data.title);
    setContentDraft(node.data.content);
  }, [node?.id, node?.data.title, node?.data.content, node]);

  useEffect(() => {
    if (previewNodeId && !node) {
      closeNodePreview();
    }
  }, [previewNodeId, node, closeNodePreview]);

  if (!previewNodeId || !node) return null;

  const isImage = node.data.kind === 'image';
  const isGallery = node.data.kind === 'gallery';
  const galleryImages = isGallery ? node.data.images ?? [] : [];
  const titleChanged = titleDraft.trim() !== node.data.title;
  const contentChanged = contentDraft !== node.data.content;
  const dirty = titleChanged || contentChanged;

  const save = async () => {
    if (!projectId || !dirty || saving) return;
    const nextTitle = titleDraft.trim() || '未命名';
    setSaving(true);
    updateNodeContent(node.id, {
      title: nextTitle,
      content: contentDraft,
    });
    try {
      await patchNode(projectId, node.id, {
        ...(nextTitle !== node.data.title ? { title: nextTitle } : {}),
        ...(contentChanged ? { content: contentDraft } : {}),
      });
      await refreshHistoryStatus(projectId);
      pushToast('success', '节点已保存');
    } catch {
      updateNodeContent(node.id, {
        title: node.data.title,
        content: node.data.content,
      });
      setTitleDraft(node.data.title);
      setContentDraft(node.data.content);
      pushToast('error', '保存节点失败');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setTitleDraft(node.data.title);
    setContentDraft(node.data.content);
  };

  return (
    <aside className="node-preview" aria-label="节点预览">
      <header className="node-preview__header">
        <div>
          <div className="node-preview__title">节点预览</div>
          <div className="node-preview__subtitle">
            {parent?.data.title ? `来自 ${parent.data.title}` : '当前选中节点'}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={closeNodePreview}
          aria-label="关闭节点预览"
        >
          ×
        </button>
      </header>

      <div className="node-preview__body">
        {isImage && node.data.imageUrl && (
          <div className="node-preview__image-wrap">
            <img
              className="node-preview__image"
              src={node.data.imageUrl}
              alt={node.data.title || '图片节点'}
            />
          </div>
        )}

        <label className="field">
          <span className="field__label">标题</span>
          <input
            className="field__control node-preview__title-input"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                void save();
              }
            }}
          />
        </label>

        {isGallery ? (
          <section className="node-preview__gallery">
            <div className="node-preview__meta-label">图库({galleryImages.length} 张)</div>
            {galleryImages.length > 0 && (
              <div className="node-preview__gallery-grid">
                {galleryImages.slice(0, 6).map((img) => (
                  <div key={img.id} className="node-preview__gallery-thumb">
                    <img src={img.url} alt={img.caption || ''} />
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (projectId) {
                  window.open(
                    `/gallery/${encodeURIComponent(projectId)}/${encodeURIComponent(node.id)}`,
                    '_blank',
                    'noopener',
                  );
                }
              }}
            >
              打开图库
            </button>
          </section>
        ) : (
          <label className="field node-preview__content-field">
            <span className="field__label">正文</span>
            <textarea
              className="field__control node-preview__content-input"
              value={contentDraft}
              onChange={(event) => setContentDraft(event.target.value)}
            />
          </label>
        )}

        {isImage && node.data.prompt && (
          <section className="node-preview__meta">
            <div className="node-preview__meta-label">图片提示词</div>
            <div className="node-preview__meta-text">{node.data.prompt}</div>
          </section>
        )}
      </div>

      <footer className="node-preview__footer">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!dirty || saving}
          onClick={reset}
        >
          还原
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!dirty || saving}
          onClick={() => {
            void save();
          }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </footer>
    </aside>
  );
}
