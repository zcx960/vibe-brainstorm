import type { Edge as RFEdge } from '@xyflow/react';
import type { IdeaRFNode } from '../store/graphStore';

const MAX_REFERENCE_PREVIEWS = 4;

interface ReferencePreview {
  readonly nodeId: string;
  readonly imageUrl: string;
  readonly title: string;
  readonly role: string;
}

interface ImageReferencePreviewProps {
  readonly nodeId: string | null;
  readonly nodes: readonly IdeaRFNode[];
  readonly edges: readonly RFEdge[];
}

function imageReferenceFor(
  node: IdeaRFNode | undefined,
  role: string,
): ReferencePreview | null {
  const imageUrl = node?.data.imageUrl;
  if (
    node?.data.kind !== 'image' ||
    typeof imageUrl !== 'string' ||
    !imageUrl.startsWith('/api/media/')
  ) {
    return null;
  }
  return {
    nodeId: node.id,
    imageUrl,
    title: node.data.title || '图片节点',
    role,
  };
}

function referencePreviewsFor(
  nodeId: string | null,
  nodes: readonly IdeaRFNode[],
  edges: readonly RFEdge[],
): ReferencePreview[] {
  if (!nodeId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const previews: ReferencePreview[] = [];
  const append = (node: IdeaRFNode | undefined, role: string) => {
    if (!node || seen.has(node.id) || previews.length >= MAX_REFERENCE_PREVIEWS) {
      return;
    }
    const preview = imageReferenceFor(node, role);
    if (!preview) return;
    seen.add(node.id);
    previews.push(preview);
  };

  append(byId.get(nodeId), '当前图片');
  for (const edge of edges) {
    if (previews.length >= MAX_REFERENCE_PREVIEWS) break;
    if (edge.target === nodeId) append(byId.get(edge.source), '上级图片');
  }
  return previews;
}

export function ImageReferencePreview({
  nodeId,
  nodes,
  edges,
}: ImageReferencePreviewProps) {
  const referencePreviews = referencePreviewsFor(nodeId, nodes, edges);

  return (
    <div className="field">
      <span className="field__label">
        参考图：自动引用 {referencePreviews.length} 张
      </span>
      {referencePreviews.length > 0 ? (
        <div className="image-references">
          {referencePreviews.map((reference) => (
            <div
              className="image-reference"
              key={reference.nodeId}
              title={`${reference.role}：${reference.title}`}
            >
              <img
                className="image-reference__img"
                src={reference.imageUrl}
                alt={reference.title}
                draggable={false}
              />
              <span className="image-reference__role">{reference.role}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="image-references__empty">
          连接上级图片节点后会自动作为参考图
        </div>
      )}
    </div>
  );
}
