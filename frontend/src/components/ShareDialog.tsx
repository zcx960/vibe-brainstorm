import { useEffect, useState } from 'react';
import { shareProject, listMembers, removeMember } from '../api/share';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import type { Member } from '../types';

interface ShareDialogProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function ShareDialog({
  projectId,
  projectName,
  onClose,
}: ShareDialogProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Fetch/create the share link and load the member list on open.
  useEffect(() => {
    let alive = true;

    shareProject(projectId)
      .then((info) => {
        if (!alive) return;
        // Build the absolute URL from the relative token; the backend returns
        // a relative `url` like /?join=<token>, but the user needs a full link.
        setShareUrl(`${location.origin}/?join=${info.token}`);
      })
      .catch(() => {
        if (alive) pushToast('error', '生成分享链接失败');
      })
      .finally(() => {
        if (alive) setLinkLoading(false);
      });

    listMembers(projectId)
      .then((list) => {
        if (alive) setMembers(list);
      })
      .catch(() => {
        if (alive) pushToast('error', '加载成员失败');
      })
      .finally(() => {
        if (alive) setMembersLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [projectId, pushToast]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      pushToast('error', '复制失败，请手动复制');
    }
  };

  const handleRemove = async (member: Member) => {
    const uid = member.user.id;
    setRemovingId(uid);
    try {
      await removeMember(projectId, uid);
      setMembers((prev) => prev.filter((m) => m.user.id !== uid));
    } catch {
      pushToast('error', '移除成员失败');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div
      className="dialog-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="分享项目"
      >
        <div className="dialog__header">
          <div>
            <div className="dialog__title">分享项目</div>
            <div className="dialog__subtitle" title={projectName}>
              {projectName}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            title="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="dialog__body">
          <div className="field">
            <span className="field__label">邀请链接（可作为编辑者加入）</span>
            <div className="share__link-row">
              <input
                className="field__control share__link-input"
                readOnly
                value={linkLoading ? '生成中…' : (shareUrl ?? '')}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleCopy}
                disabled={linkLoading || !shareUrl}
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>

          <div className="share__members">
            <span className="field__label">成员</span>
            {membersLoading ? (
              <div className="share__members-empty">加载中…</div>
            ) : members.length === 0 ? (
              <div className="share__members-empty">暂无成员</div>
            ) : (
              <ul className="share__members-list">
                {members.map((m) => {
                  const isOwner = m.role === 'owner';
                  const isSelf = m.user.id === currentUserId;
                  return (
                    <li key={m.user.id} className="share__member">
                      <span
                        className="share__member-dot"
                        style={{ background: m.user.color }}
                        aria-hidden
                      />
                      <span className="share__member-info">
                        <span className="share__member-name">
                          {m.user.display_name || m.user.username}
                          {isSelf && (
                            <span className="share__member-you">（你）</span>
                          )}
                        </span>
                        <span className="share__member-email">
                          {m.user.username}
                        </span>
                      </span>
                      <span className="share__member-role">
                        {isOwner ? '所有者' : '编辑者'}
                      </span>
                      {!isOwner && (
                        <button
                          type="button"
                          className="share__member-remove"
                          title="移除成员"
                          onClick={() => handleRemove(m)}
                          disabled={removingId === m.user.id}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
