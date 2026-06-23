<div align="center">
  <h1>Vibe Brainstorm</h1>

  <p>An AI infinite-canvas workspace for branching ideas into text and image nodes.</p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Web%20%7C%20Docker-2f6fed?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/React-19-2d9cdb?style=flat-square" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/FastAPI-0.110%2B-009688?style=flat-square" alt="FastAPI" />
    <img src="https://img.shields.io/badge/PostgreSQL-17-4169e1?style=flat-square" alt="PostgreSQL 17" />
    <img src="https://img.shields.io/badge/API-OpenAI--compatible-3a7f52?style=flat-square" alt="OpenAI-compatible API" />
  </p>

  <p><strong>English</strong> | <a href="./README.md">中文</a></p>
</div>

Vibe Brainstorm is a collaborative infinite-canvas app for creative work, product thinking, story planning, and visual exploration. You can create nodes on a canvas, expand any idea node with an LLM, generate multiple image nodes from a text or image node, and keep iterating with image references.

The core workflow is "node -> expansion -> more expansion": text nodes can branch into idea children, text or image nodes can branch into generated image children, and image nodes can be reused as references for later image generation.

## Overview

- Infinite canvas: draggable nodes, edges, zooming, layout, and multi-user cursors powered by React Flow.
- Brainstorm expansion: generate 1 to 10 child ideas from a node, with built-in modes for general ideation, screenplays, product ideas, and art direction.
- Image expansion: generate up to 10 images concurrently from a node, persist them to the media volume, and attach them back to the canvas as image nodes.
- Image references: upstream image nodes are automatically used as references, up to 4 images.
- Image uploads: right-click the canvas to upload an image node, or right-click a node to upload an image child.
- Context menu: add nodes, upload images, start brainstorm/image expansion, delete nodes, auto-layout, and fit the view.
- Admin panel: manage OpenAI-compatible providers, text models, image models, and API keys under `/admin`.
- Real-time collaboration: project updates, presence, nodes, and edges are broadcast over WebSocket.

## Stack

- Frontend: React 19, Vite, TypeScript, `@xyflow/react`, Zustand, elkjs
- Backend: FastAPI, SQLAlchemy async, Pydantic, official `openai` SDK
- Database: PostgreSQL 17
- Deployment: Docker Compose, Nginx static hosting and `/api` reverse proxy
- Model API: OpenAI-compatible chat and images APIs

## Architecture

```text
Browser
  -> frontend (Nginx static files + /api proxy)
  -> backend (FastAPI)
  -> PostgreSQL
  -> OpenAI-compatible providers

Generated and uploaded images
  -> Docker volume media_data
  -> /api/media/*
```

## Quick Start

### Requirements

- Docker and Docker Compose
- At least one API key for a text model provider
- An image-capable provider if you want to use image expansion

### Run

```bash
cp .env.example .env
# Edit .env: add API keys, JWT_SECRET, ADMIN_PASSWORD, and database password.
docker compose up -d --build
```

Default URL:

```text
http://localhost:8080
```

If `APP_PORT` is changed in `.env`, open `http://localhost:<APP_PORT>`.

### Health Checks

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/config/providers
```

## Configuration

### Environment

Copy `.env.example` to `.env`, then fill in at least one provider key:

```bash
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=
ZHIPU_API_KEY=
MOONSHOT_API_KEY=
OLLAMA_API_KEY=ollama
```

Change these before production deployment:

```bash
JWT_SECRET=change-me-to-a-long-random-secret
ADMIN_PASSWORD=change-me-before-deploy
POSTGRES_PASSWORD=change-me-before-deploy
```

### Providers and Models

Initial providers are defined in [`backend/providers.yaml`](backend/providers.yaml). They are seeded into the database on first startup, then managed through `/admin`:

- `base_url`: OpenAI-compatible API root URL
- `models`: text models for brainstorm expansion
- `image_models`: image models for image expansion
- `api_key`: stored server-side only and never sent to the browser

The default catalog includes DeepSeek, OpenAI, DashScope, Zhipu GLM, Moonshot, and local Ollama examples.

## Image Generation and Uploads

- Image expansion is available from node buttons and the context menu, next to brainstorm expansion.
- Each run can generate 1 to 10 images; the backend generates concurrently and streams results as they arrive.
- Presets cover characters, storyboards, keyframes, scenes, product shots, covers, style exploration, materials, and mascots.
- Image nodes can start another image expansion pass, which makes character variations and reference-based iteration natural.
- If the current node or upstream nodes contain images, the backend automatically uses up to 4 `/api/media` images as references.
- Uploads support PNG, JPEG, WebP, and GIF. The single-file limit is 25MB.

## Brainstorm Modes

Built-in modes live in [`backend/app/prompts/modes/`](backend/app/prompts/modes/):

- `general`: general ideation
- `screenplay`: screenplay writing
- `project`: product and startup ideas
- `art`: art direction

Each mode is a YAML file with a `system_prompt` and an `expansion_template`. Add a new `*.yaml` file to create another mode.

## Local Development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:8000`.

### Test and Build

```bash
cd backend
python -m pytest

cd ../frontend
npm run build
```

## Server Deployment

Do not upload local `.env` files, database volumes, media files, `node_modules`, build artifacts, test screenshots, or local archives. On the server:

```bash
cp .env.example .env
# Edit .env
docker compose up -d --build
```

Docker Compose creates:

- `db_data`: PostgreSQL data
- `media_data`: generated and uploaded images

The frontend Nginx upload limit is 25MB, matching the backend image upload limit.

## Privacy and Security

- API keys are read and stored server-side. `/api/config/providers` only returns model names and availability.
- `.env`, runtime media, database volumes, dependency folders, and build outputs are ignored by Git.
- The admin panel uses `ADMIN_PASSWORD`; do not keep the default in production.
- `JWT_SECRET` should be a long random string.

## Known Limitations

- Image generation requires an upstream provider compatible with OpenAI images APIs. Provider support for `images.generate` and `images.edit` may vary.
- Image references are currently read from this project's `/api/media` image nodes only. Arbitrary external image URLs are not fetched.
- If no image model is configured, the image expansion panel will ask you to add one in the admin panel first.
- The repository does not include official screenshots or a license file yet.

## Contributing

Issues and pull requests are welcome. Before submitting, run the full app through Docker Compose and check:

```bash
python -m pytest
npm run build
```

## License

No license file has been added yet. Add an explicit open-source license before public distribution or commercial reuse.
