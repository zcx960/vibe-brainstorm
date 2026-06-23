import type { NodeTypes } from '@xyflow/react';
import { IdeaNode } from './IdeaNode';
import { ImageNode } from './ImageNode';

export const nodeTypes: NodeTypes = {
  idea: IdeaNode,
  image: ImageNode,
};
