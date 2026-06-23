# Brainstorm Design System

## 1. Atmosphere & Identity

Brainstorm is a quiet infinite-canvas workspace for fast idea branching. It should feel focused, compact, and responsive: a working surface with light operational chrome, not a marketing page. The signature is restrained depth: crisp panels, subtle shadows, and indigo accents that mark active decisions without overwhelming the canvas.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Background | `--bg` | `#f6f7fb` | `#0f1117` | App background and canvas surround |
| Surface | `--surface` | `#ffffff` | `#181b24` | Toolbars, panels, nodes, dialogs |
| Surface secondary | `--surface-2` | `#f1f2f7` | `#222632` | Hover fills, segmented controls |
| Border | `--border` | `#e4e6ef` | `#2b2f3c` | Default dividers and outlines |
| Border strong | `--border-strong` | `#d3d6e4` | `#3a3f4f` | Inputs and stronger controls |
| Text | `--text` | `#1f2333` | `#e6e8f0` | Main UI text |
| Text muted | `--text-muted` | `#6b7080` | `#9aa0b4` | Labels, secondary copy |
| Primary | `--primary` | `#6366f1` | `#7c83ff` | Primary actions, handles, focus |
| Primary strong | `--primary-strong` | `#4f46e5` | `#6970f0` | Primary hover and active text |
| Primary soft | `--primary-soft` | `#eef0ff` | `#232545` | Selected fills, soft buttons |
| Busy expand | `--busy-expand-1..3`, `--busy-expand-glow` | `#22d3ee`, `#3b82f6`, `#6366f1`, `rgba(59, 130, 246, 0.28)` | `#38bdf8`, `#60a5fa`, `#818cf8`, `rgba(96, 165, 250, 0.35)` | Cool flowing border for brainstorm expansion |
| Busy image | `--busy-image-1..5`, `--busy-image-glow` | `#22d3ee`, `#a855f7`, `#f59e0b`, `#22c55e`, `#ef4444`, `rgba(168, 85, 247, 0.3)` | `#22d3ee`, `#c084fc`, `#fbbf24`, `#4ade80`, `#fb7185`, `rgba(192, 132, 252, 0.36)` | Colorful flowing border for image generation |
| Danger | `--danger` | `#e5484d` | `#f0656a` | Errors, destructive actions |
| Success | `--success` | `#2f9e44` | `#41c46a` | Confirmations |

### Rules

- Use primary only for actions, focus, selection, and graph handles.
- Use danger only for destructive or failed states.
- New colors must first be added here as semantic roles.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| H1 | 22px | 800 | 1.25 | 0 | Admin/login brand headings |
| H2 | 20px | 800 | 1.3 | 0 | Admin shell headings |
| H3 | 15px | 700 | 1.35 | 0 | Panel and dialog titles |
| Body | 14px | 500 | 1.5 | 0 | Main controls and toolbar text |
| Body/sm | 13px | 400-600 | 1.5 | 0 | Buttons, table cells, node content |
| Caption | 12px | 600 | 1.4 | 0 | Field labels and metadata |
| Overline | 11px | 700 | 1.3 | 0.05em | Table headers |

### Font Stack

- Primary: system UI, `-apple-system`, `Segoe UI`, Roboto, `Helvetica Neue`, `PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei`, sans-serif.
- Mono: `ui-monospace`, `SFMono-Regular`, Menlo, Consolas, monospace.

### Rules

- Body text in compact controls may use 13px; long reading text should stay at 14px or above.
- Letter spacing stays at 0 except overline/table labels.

## 4. Spacing & Layout

### Base Unit

All spacing derives from a base of 4px.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Icon-to-label gaps and tight chips |
| `--space-2` | 8px | Button gaps and compact stacks |
| `--space-3` | 12px | Node padding and table cells |
| `--space-4` | 16px | Panel padding and modal sections |
| `--space-5` | 20px | Toast offsets and medium rhythm |
| `--space-6` | 24px | Auth/admin outer padding |
| `--space-8` | 32px | Large modal or section gaps |

### Grid

- Shell: fixed 52px toolbar, 232px sidebar, remaining area as canvas.
- Panels: 360px side panel, capped at 90vw.
- Nodes: idea nodes are 240px wide; generated image nodes should stay stable with an aspect-ratio frame.
- Breakpoints: compact behavior begins below 768px.

### Rules

- Use multiples of 4px for dimensions, padding, gaps, and offsets.
- Keep operational UI dense and scannable.

## 5. Components

### Button

- Structure: native `button` with `.btn` or compact node-action class.
- Variants: default, primary, ghost, small.
- Spacing: 8px internal gap; heights 30px, 34px, or 40px depending on density.
- States: hover, active, disabled, loading.
- Accessibility: visible labels or `aria-label` for icon-only actions.
- Motion: 120ms background/border transition, 1px active translate.

### Side Panel

- Structure: scrim plus fixed right `aside` dialog.
- Variants: expansion and image generation share the same panel shell.
- Spacing: 16px header/body padding, 12px footer padding.
- States: open, close, disabled submit, loading source node.
- Image generation panels may include dense preset grids and up to 4 automatic reference thumbnails. Preset controls use bordered 2-column buttons; reference thumbnails use square cells with compact role labels.
- Accessibility: `role="dialog"` and descriptive `aria-label`.
- Motion: 180ms transform/opacity slide-in.

### Canvas Node

- Structure: fixed-width surface with top/bottom handles.
- Variants: idea node, image node.
- Spacing: 12px internal padding, 10px footer separation.
- States: hover, selected, peer-selected, image-broken, busy expanding, busy generating.
- Image nodes expose the image generation action so generated images can be iterated with themselves and upstream image nodes as references.
- Busy expanding uses a cool cyan/blue/indigo flowing border; busy generating uses a colorful flowing border. Both stay outside the node box and must not shift layout.
- Accessibility: all action buttons are keyboard reachable and labeled.
- Motion: 150ms shadow/border transition.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 100-150ms | ease-out | Button hover, active press |
| Standard | 160-220ms | ease-out | Panel, dialog, toast entry |
| Continuous | 700ms | linear | Loading spinner |
| Flow | 1400ms | linear | Node busy flowing border |

### Rules

- Animate only `transform`, `opacity`, `box-shadow`, `border-color`, and color/background transitions, except the masked node busy border may animate its registered gradient angle.
- Every submit path must expose disabled or loading feedback.
- Respect compact workflows: panels close after a job starts, while node-level busy state remains visible.

## 7. Depth & Surface

### Strategy

Mixed, with borders as the default and shadows only for raised surfaces.

| Level | Token | Usage |
|-------|-------|-------|
| Subtle | `--shadow-sm` | Nodes, cards, minimap, active segmented items |
| Prominent | `--shadow-md` | Side panels, dialogs, toasts, hovered nodes |

### Rules

- Default surfaces use a border plus subtle shadow.
- Prominent shadows are reserved for overlays, dialogs, and hovered/selected canvas elements.
