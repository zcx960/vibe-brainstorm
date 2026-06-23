import { useUiStore } from '../store/uiStore';
import { useGraphStore } from '../store/graphStore';
import { useExpand } from '../features/brainstorm/useExpand';
import { ModeProviderSelectors } from './ModeProviderSelectors';
import type { ContextStrategy, ExpandRequest } from '../types';

const STRATEGIES: { id: ContextStrategy; label: string; hint: string }[] = [
  { id: 'node', label: '仅当前节点', hint: '只把该节点内容给模型' },
  { id: 'ancestors', label: '含祖先链路', hint: '附带从根到该节点的路径' },
  { id: 'full', label: '整张图谱', hint: '把整个画布作为上下文' },
];

export function ExpandPanel() {
  const panelOpen = useUiStore((s) => s.panelOpen);
  const expandSourceId = useUiStore((s) => s.expandSourceId);
  const closePanel = useUiStore((s) => s.closePanel);

  const mode = useUiStore((s) => s.mode);
  const provider = useUiStore((s) => s.provider);
  const model = useUiStore((s) => s.model);
  const count = useUiStore((s) => s.count);
  const instruction = useUiStore((s) => s.instruction);
  const contextStrategy = useUiStore((s) => s.contextStrategy);
  const setCount = useUiStore((s) => s.setCount);
  const setInstruction = useUiStore((s) => s.setInstruction);
  const setContextStrategy = useUiStore((s) => s.setContextStrategy);
  const expandingNodeIds = useUiStore((s) => s.expandingNodeIds);

  const projectId = useGraphStore((s) => s.projectId);
  const sourceNode = useGraphStore((s) =>
    s.rfNodes.find((n) => n.id === expandSourceId),
  );

  const { expand } = useExpand();

  if (!panelOpen || !expandSourceId) return null;

  const isBusy = expandingNodeIds.has(expandSourceId);
  const canStart = Boolean(projectId && mode && provider && model && !isBusy);

  const start = () => {
    if (!projectId || !canStart) return;
    const req: ExpandRequest = {
      project_id: projectId,
      node_id: expandSourceId,
      mode,
      provider,
      model,
      count,
      context_strategy: contextStrategy,
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
    };
    expand(req);
    closePanel();
  };

  return (
    <>
      <div className="panel-scrim" onClick={closePanel} />
      <aside className="expand-panel" role="dialog" aria-label="脑爆扩展">
        <header className="expand-panel__header">
          <div>
            <div className="expand-panel__title">脑爆扩展</div>
            <div className="expand-panel__subtitle">
              基于「{sourceNode?.data.title || '所选节点'}」发散
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={closePanel}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="expand-panel__body">
          <ModeProviderSelectors />

          <label className="field">
            <span className="field__label">
              生成数量：<strong>{count}</strong>
            </span>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span className="field__label">补充指引（可选）</span>
            <textarea
              className="field__control"
              rows={3}
              placeholder="例如：更偏向商业落地、面向青少年、走悬疑风格…"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>

          <div className="field">
            <span className="field__label">上下文范围</span>
            <div className="segmented">
              {STRATEGIES.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  title={s.hint}
                  className={`segmented__item${
                    contextStrategy === s.id ? ' segmented__item--active' : ''
                  }`}
                  onClick={() => setContextStrategy(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="expand-panel__footer">
          <button type="button" className="btn btn--ghost" onClick={closePanel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canStart}
            onClick={start}
          >
            开始脑爆
          </button>
        </footer>
      </aside>
    </>
  );
}
