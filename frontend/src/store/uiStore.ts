import { create } from 'zustand';
import type { Project, Provider, Mode, ContextStrategy } from '../types';

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  message: string;
}

interface UiState {
  // Config loaded from /api/config.
  providers: Provider[];
  modes: Mode[];
  defaultProvider: string;
  defaultModel: string;

  // Projects.
  projects: Project[];
  currentProjectId: string | null;

  // Expansion selection / form state.
  mode: string;
  provider: string;
  model: string;
  count: number;
  instruction: string;
  contextStrategy: ContextStrategy;

  // The node currently targeted by the expand panel.
  expandSourceId: string | null;
  panelOpen: boolean;

  // Right-side node preview / editor.
  previewNodeId: string | null;

  // Set of node ids that are mid-expansion (showing a spinner).
  expandingNodeIds: Set<string>;

  // ---- image generation panel / form state ----
  imagePanelNodeId: string | null;
  imageProvider: string;
  imageModel: string;
  imageCount: number;
  imageSize: string;
  imagePrompt: string;
  // Set of source node ids currently generating images (spinner).
  generatingNodeIds: Set<string>;

  // Sidebar visibility.
  sidebarOpen: boolean;

  // Delete confirmation dialog.
  deleteConfirmNodeId: string | null;
  deleteConfirmNodeLabel: string;
  deleteConfirmNodeIds: string[];
  deleteConfirmEdgeIds: string[];
  deleteConfirmOpen: boolean;
  deleteConfirmBypassOnce: boolean;

  // Toasts.
  toasts: Toast[];

  // ---- actions ----
  setConfig: (data: {
    providers: Provider[];
    modes: Mode[];
    defaultProvider: string;
    defaultModel: string;
  }) => void;
  setProjects: (projects: Project[]) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setCurrentProject: (id: string | null) => void;

  setMode: (mode: string) => void;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setCount: (count: number) => void;
  setInstruction: (instruction: string) => void;
  setContextStrategy: (s: ContextStrategy) => void;

  openExpandPanel: (nodeId: string) => void;
  closePanel: () => void;
  openNodePreview: (nodeId: string) => void;
  closeNodePreview: () => void;

  startExpanding: (nodeId: string) => void;
  stopExpanding: (nodeId: string) => void;

  // ---- image panel actions ----
  setImageProvider: (provider: string) => void;
  setImageModel: (model: string) => void;
  setImageCount: (count: number) => void;
  setImageSize: (size: string) => void;
  setImagePrompt: (prompt: string) => void;
  openImagePanel: (nodeId: string, defaultPrompt?: string) => void;
  closeImagePanel: () => void;
  startGenerating: (nodeId: string) => void;
  stopGenerating: (nodeId: string) => void;

  setSidebarOpen: (open: boolean) => void;

  openDeleteConfirm: (nodeId: string, label: string) => void;
  openDeleteConfirmFromFlow: (payload: {
    nodes: { id: string; label: string }[];
    edges: { id: string }[];
  }) => void;
  closeDeleteConfirm: () => void;
  approveDeleteOnce: () => void;

  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
}

function firstAvailableModel(provider: Provider | undefined): string {
  if (!provider) return '';
  return provider.models[0] ?? '';
}

function firstImageModel(provider: Provider | undefined): string {
  if (!provider) return '';
  return provider.image_models?.[0] ?? '';
}

// First provider that has at least one image model configured (preferring an
// available one). Used to seed the image panel form.
function firstImageProvider(providers: Provider[]): Provider | undefined {
  const withImages = providers.filter(
    (p) => (p.image_models?.length ?? 0) > 0,
  );
  return withImages.find((p) => p.available) ?? withImages[0];
}

function clampGenerateCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(10, Math.max(1, Math.trunc(count)));
}

export const useUiStore = create<UiState>((set, get) => ({
  providers: [],
  modes: [],
  defaultProvider: '',
  defaultModel: '',

  projects: [],
  currentProjectId: null,

  mode: '',
  provider: '',
  model: '',
  count: 4,
  instruction: '',
  contextStrategy: 'ancestors',

  expandSourceId: null,
  panelOpen: false,
  previewNodeId: null,
  expandingNodeIds: new Set<string>(),

  imagePanelNodeId: null,
  imageProvider: '',
  imageModel: '',
  imageCount: 4,
  imageSize: '1024x1024',
  imagePrompt: '',
  generatingNodeIds: new Set<string>(),

  sidebarOpen: true,

  deleteConfirmNodeId: null,
  deleteConfirmNodeLabel: '',
  deleteConfirmNodeIds: [],
  deleteConfirmEdgeIds: [],
  deleteConfirmOpen: false,
  deleteConfirmBypassOnce: false,

  toasts: [],

  setConfig: ({ providers, modes, defaultProvider, defaultModel }) =>
    set((state) => ({
      providers,
      modes,
      defaultProvider,
      defaultModel,
      provider: state.provider || defaultProvider,
      model: state.model || defaultModel,
      mode: state.mode || modes[0]?.id || '',
    })),

  setProjects: (projects) => set({ projects }),
  upsertProject: (project) =>
    set((state) => {
      const exists = state.projects.some((p) => p.id === project.id);
      return {
        projects: exists
          ? state.projects.map((p) => (p.id === project.id ? project : p))
          : [project, ...state.projects],
      };
    }),
  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProjectId:
        state.currentProjectId === id ? null : state.currentProjectId,
    })),
  setCurrentProject: (id) => {
    const project = get().projects.find((p) => p.id === id);
    set({
      currentProjectId: id,
      previewNodeId: null,
      // Reset the expand form's mode to the project default when switching.
      mode: project?.default_mode || get().mode,
    });
  },

  setMode: (mode) => set({ mode }),
  setProvider: (provider) =>
    set((state) => {
      const p = state.providers.find((x) => x.id === provider);
      const modelValid = p?.models.includes(state.model);
      return {
        provider,
        model: modelValid ? state.model : firstAvailableModel(p),
      };
    }),
  setModel: (model) => set({ model }),
  setCount: (count) => set({ count: clampGenerateCount(count) }),
  setInstruction: (instruction) => set({ instruction }),
  setContextStrategy: (contextStrategy) => set({ contextStrategy }),

  openExpandPanel: (nodeId) =>
    set((state) => {
      const project = state.projects.find(
        (p) => p.id === state.currentProjectId,
      );
      return {
        expandSourceId: nodeId,
        panelOpen: true,
        previewNodeId: null,
        imagePanelNodeId: null,
        // Prefill mode from project default if the form hasn't diverged.
        mode: state.mode || project?.default_mode || state.modes[0]?.id || '',
        instruction: '',
      };
    }),
  closePanel: () => set({ panelOpen: false, expandSourceId: null }),

  openNodePreview: (nodeId) =>
    set({
      previewNodeId: nodeId,
      panelOpen: false,
      expandSourceId: null,
      imagePanelNodeId: null,
    }),
  closeNodePreview: () => set({ previewNodeId: null }),

  startExpanding: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandingNodeIds);
      next.add(nodeId);
      return { expandingNodeIds: next };
    }),
  stopExpanding: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandingNodeIds);
      next.delete(nodeId);
      return { expandingNodeIds: next };
    }),

  setImageProvider: (provider) =>
    set((state) => {
      const p = state.providers.find((x) => x.id === provider);
      const modelValid = p?.image_models?.includes(state.imageModel);
      return {
        imageProvider: provider,
        imageModel: modelValid ? state.imageModel : firstImageModel(p),
      };
    }),
  setImageModel: (imageModel) => set({ imageModel }),
  setImageCount: (imageCount) =>
    set({ imageCount: clampGenerateCount(imageCount) }),
  setImageSize: (imageSize) => set({ imageSize }),
  setImagePrompt: (imagePrompt) => set({ imagePrompt }),

  openImagePanel: (nodeId, defaultPrompt) =>
    set((state) => {
      // Seed provider/model from the first image-capable provider if the form
      // hasn't been pointed at one yet (or the prior pick lost its models).
      const current = state.providers.find((p) => p.id === state.imageProvider);
      const hasImageModels = (current?.image_models?.length ?? 0) > 0;
      const seedProvider = hasImageModels
        ? current
        : firstImageProvider(state.providers);
      const provider = seedProvider?.id ?? '';
      const modelValid = seedProvider?.image_models?.includes(state.imageModel);
      const model = modelValid ? state.imageModel : firstImageModel(seedProvider);
      return {
        imagePanelNodeId: nodeId,
        previewNodeId: null,
        panelOpen: false,
        expandSourceId: null,
        imageProvider: provider,
        imageModel: model,
        imagePrompt: defaultPrompt ?? state.imagePrompt,
      };
    }),
  closeImagePanel: () => set({ imagePanelNodeId: null }),

  startGenerating: (nodeId) =>
    set((state) => {
      const next = new Set(state.generatingNodeIds);
      next.add(nodeId);
      return { generatingNodeIds: next };
    }),
  stopGenerating: (nodeId) =>
    set((state) => {
      const next = new Set(state.generatingNodeIds);
      next.delete(nodeId);
      return { generatingNodeIds: next };
    }),

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  openDeleteConfirm: (deleteConfirmNodeId, deleteConfirmNodeLabel) =>
    set({
      deleteConfirmNodeId,
      deleteConfirmNodeLabel,
      deleteConfirmNodeIds: [deleteConfirmNodeId],
      deleteConfirmEdgeIds: [],
      deleteConfirmOpen: true,
      deleteConfirmBypassOnce: false,
    }),
  openDeleteConfirmFromFlow: ({ nodes, edges }) =>
    set({
      deleteConfirmNodeId: nodes[0]?.id ?? null,
      deleteConfirmNodeLabel: nodes[0]?.label ?? '',
      deleteConfirmNodeIds: nodes.map((node) => node.id),
      deleteConfirmEdgeIds: edges.map((edge) => edge.id),
      deleteConfirmOpen: true,
      deleteConfirmBypassOnce: false,
    }),
  closeDeleteConfirm: () =>
    set({
      deleteConfirmOpen: false,
      deleteConfirmNodeId: null,
      deleteConfirmNodeLabel: '',
      deleteConfirmNodeIds: [],
      deleteConfirmEdgeIds: [],
      deleteConfirmBypassOnce: false,
    }),
  approveDeleteOnce: () => set({ deleteConfirmBypassOnce: true }),

  pushToast: (kind, message) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, message },
      ],
    })),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
