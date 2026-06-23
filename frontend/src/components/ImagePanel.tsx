import { useUiStore } from '../store/uiStore';
import { useGraphStore } from '../store/graphStore';
import { useImageGen } from '../features/imagegen/useImageGen';
import { IMAGE_PRESETS, type ImagePreset } from '../lib/imagePresets';
import { ImageReferencePreview } from './ImageReferencePreview';
import type { ImageGenerateRequest } from '../types';

const SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;

function appendPresetPrompt(current: string, preset: ImagePreset): string {
  const cleaned = current.trim();
  return cleaned ? `${cleaned}\n\n${preset.prompt}` : preset.prompt;
}

export function ImagePanel() {
  const imagePanelNodeId = useUiStore((s) => s.imagePanelNodeId);
  const closeImagePanel = useUiStore((s) => s.closeImagePanel);
  const providers = useUiStore((s) => s.providers);
  const imageProvider = useUiStore((s) => s.imageProvider);
  const imageModel = useUiStore((s) => s.imageModel);
  const imageCount = useUiStore((s) => s.imageCount);
  const imageSize = useUiStore((s) => s.imageSize);
  const imagePrompt = useUiStore((s) => s.imagePrompt);
  const setImageProvider = useUiStore((s) => s.setImageProvider);
  const setImageModel = useUiStore((s) => s.setImageModel);
  const setImageCount = useUiStore((s) => s.setImageCount);
  const setImageSize = useUiStore((s) => s.setImageSize);
  const setImagePrompt = useUiStore((s) => s.setImagePrompt);
  const generatingNodeIds = useUiStore((s) => s.generatingNodeIds);

  const projectId = useGraphStore((s) => s.projectId);
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const sourceNode = rfNodes.find((n) => n.id === imagePanelNodeId);
  const { generate } = useImageGen();

  if (!imagePanelNodeId) return null;

  const imageProviders = providers.filter(
    (provider) => provider.image_models.length > 0,
  );
  const selectedProvider = imageProviders.find((p) => p.id === imageProvider);
  const isBusy = generatingNodeIds.has(imagePanelNodeId);
  const canStart = Boolean(
    projectId &&
      imageProvider &&
      imageModel &&
      selectedProvider?.available &&
      !isBusy,
  );

  const start = () => {
    if (!projectId || !canStart) return;
    const request: ImageGenerateRequest = {
      project_id: projectId,
      node_id: imagePanelNodeId,
      provider: imageProvider,
      model: imageModel,
      count: imageCount,
      size: imageSize,
      ...(imagePrompt.trim() ? { prompt: imagePrompt.trim() } : {}),
    };
    generate(request);
    closeImagePanel();
  };

  return (
    <>
      <div className="panel-scrim" onClick={closeImagePanel} />
      <aside className="expand-panel" role="dialog" aria-label="生图扩展">
        <header className="expand-panel__header">
          <div>
            <div className="expand-panel__title">生图扩展</div>
            <div className="expand-panel__subtitle">
              基于「{sourceNode?.data.title || '所选节点'}」生成图片
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={closeImagePanel}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="expand-panel__body">
          {imageProviders.length === 0 ? (
            <div className="panel-empty">
              后台还没有配置生图模型，请先在管理后台给服务商添加生图模型。
            </div>
          ) : (
            <>
              <label className="field">
                <span className="field__label">服务商</span>
                <select
                  className="field__control"
                  value={imageProvider}
                  onChange={(e) => setImageProvider(e.target.value)}
                >
                  {imageProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.available ? '' : '（缺少密钥）'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">生图模型</span>
                <select
                  className="field__control"
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                >
                  {(selectedProvider?.image_models ?? []).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">
                  生成数量：<strong>{imageCount}</strong>
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={imageCount}
                  onChange={(e) => setImageCount(Number(e.target.value))}
                />
              </label>

              <label className="field">
                <span className="field__label">画幅</span>
                <div className="segmented">
                  {SIZES.map((size) => (
                    <button
                      type="button"
                      key={size}
                      className={`segmented__item${
                        imageSize === size ? ' segmented__item--active' : ''
                      }`}
                      onClick={() => setImageSize(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </label>

              <div className="field">
                <span className="field__label">
                  预设：<strong>{IMAGE_PRESETS.length}</strong> 个方向
                </span>
                <div className="image-presets">
                  {IMAGE_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className="image-preset"
                      title={preset.prompt}
                      onClick={() =>
                        setImagePrompt(appendPresetPrompt(imagePrompt, preset))
                      }
                    >
                      <span className="image-preset__category">
                        {preset.category}
                      </span>
                      <span className="image-preset__label">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <ImageReferencePreview
                nodeId={imagePanelNodeId}
                nodes={rfNodes}
                edges={rfEdges}
              />

              <label className="field">
                <span className="field__label">提示词（可选）</span>
                <textarea
                  className="field__control"
                  rows={5}
                  placeholder="留空则使用节点标题和内容"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <footer className="expand-panel__footer">
          <button type="button" className="btn btn--ghost" onClick={closeImagePanel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canStart}
            onClick={start}
          >
            开始生图
          </button>
        </footer>
      </aside>
    </>
  );
}
