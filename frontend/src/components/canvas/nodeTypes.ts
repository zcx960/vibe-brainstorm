import type { NodeTypes } from '@xyflow/react';
import { IdeaNode } from './IdeaNode';
import { ImageNode } from './ImageNode';
import { DocNode } from './DocNode';
import { RegionNode } from './RegionNode';
import { GalleryNode } from './GalleryNode';

export const nodeTypes: NodeTypes = {
  idea: IdeaNode,
  image: ImageNode,
  document: DocNode,
  region: RegionNode,
  gallery: GalleryNode,
};
