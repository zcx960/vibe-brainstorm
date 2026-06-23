import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';

interface DeleteConfirmDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const open = useUiStore((s) => s.deleteConfirmOpen);
  const label = useUiStore((s) => s.deleteConfirmNodeLabel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="dialog dialog--compact"
        role="dialog"
        aria-modal="true"
        aria-label="删除节点确认"
      >
        <div className="dialog__header">
          <div>
            <div className="dialog__title">删除节点</div>
            <div className="dialog__subtitle">{label || '未命名节点'}</div>
          </div>
          <button type="button" className="icon-btn" title="关闭" onClick={onCancel}>
            ✕
          </button>
        </div>
        <div className="dialog__body">
          <p className="delete-confirm__text">删除后可以通过历史回退恢复。</p>
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onConfirm}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
