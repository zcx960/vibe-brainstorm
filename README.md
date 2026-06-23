<div align="center">
  <h1>Vibe Brainstorm</h1>

  <p>AI 无限画布脑爆平台：把一个想法扩展成想法树，把文字节点继续生成图片节点。</p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Web%20%7C%20Docker-2f6fed?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/React-19-2d9cdb?style=flat-square" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/FastAPI-0.110%2B-009688?style=flat-square" alt="FastAPI" />
    <img src="https://img.shields.io/badge/PostgreSQL-17-4169e1?style=flat-square" alt="PostgreSQL 17" />
    <img src="https://img.shields.io/badge/API-OpenAI--compatible-3a7f52?style=flat-square" alt="OpenAI-compatible API" />
  </p>

  <p><a href="./README.en.md">English</a> | <strong>中文</strong></p>
</div>

Vibe Brainstorm 是一个面向创作、产品策划和视觉探索的多人协作无限画布。你可以在画布上创建节点，让大模型从某个节点继续做脑爆扩展；也可以接入 OpenAI-compatible 生图 API，把节点内容生成多张图片，并把图片作为新的画布节点继续迭代。

它的核心工作流是「节点 - 扩展 - 再扩展」：文字节点可以生成多个想法子节点，文字或图片节点可以生成多个图片子节点，图片节点还可以作为下一轮生图参考。适合剧本分镜、角色设定、产品灵感、艺术方向、品牌视觉和通用脑暴。

## 项目概览

- 无限画布：基于 React Flow 的可拖拽节点画布，支持节点、连线、布局、缩放和多人光标。
- 脑爆扩展：对任意想法节点生成 1 到 10 个子节点，内置通用、剧本创作、项目灵感、艺术创作等模式。
- 生图扩展：对节点并发生成最多 10 张图片，图片会保存到媒体卷，并作为图片节点挂回画布。
- 图片参考：当上级节点包含图片时，会自动作为参考图参与生图，最多使用 4 张参考图。
- 图片上传：右键菜单可直接添加图片节点，也可给某个节点上传图片子节点。
- 右键菜单：在画布或节点上快速添加节点、上传图片、发起脑爆/生图、删除节点、整理布局。
- 管理后台：在 `/admin` 管理 OpenAI-compatible 服务商、文本模型、生图模型和 API Key。
- 实时协作：项目内通过 WebSocket 广播节点、连线、在线状态和协作事件。

## 技术栈

- 前端：React 19, Vite, TypeScript, `@xyflow/react`, Zustand, elkjs
- 后端：FastAPI, SQLAlchemy async, Pydantic, official `openai` SDK
- 数据库：PostgreSQL 17
- 部署：Docker Compose, Nginx static hosting and `/api` reverse proxy
- 模型接口：OpenAI-compatible chat and images APIs

## 架构

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

## 快速开始

### 前置要求

- Docker and Docker Compose
- 至少一个可用的文本模型 API Key
- 如果使用生图扩展，需要配置支持 images API 的生图模型

### 启动

```bash
cp .env.example .env
# 编辑 .env：填 API Key，并修改 JWT_SECRET / ADMIN_PASSWORD / 数据库密码
docker compose up -d --build
```

默认访问地址：

```text
http://localhost:8080
```

如果 `.env` 里改了 `APP_PORT`，访问 `http://localhost:<APP_PORT>`。

### 健康检查

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/config/providers
```

## 配置说明

### 环境变量

把 `.env.example` 复制为 `.env`，然后至少填写一个 provider 的 API Key：

```bash
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=
ZHIPU_API_KEY=
MOONSHOT_API_KEY=
OLLAMA_API_KEY=ollama
```

生产环境务必修改：

```bash
JWT_SECRET=change-me-to-a-long-random-secret
ADMIN_PASSWORD=change-me-before-deploy
POSTGRES_PASSWORD=change-me-before-deploy
```

### Provider 和模型

初始服务商定义在 [`backend/providers.yaml`](backend/providers.yaml)。首次启动时会写入数据库，之后可以在 `/admin` 管理：

- `base_url`：OpenAI-compatible API 根地址
- `models`：脑爆扩展使用的文本模型
- `image_models`：生图扩展使用的图片模型
- `api_key`：仅存储在后端和数据库中，不会下发到前端

内置示例包含 DeepSeek、OpenAI、通义千问、智谱 GLM、Moonshot 和本地 Ollama。

## 生图与图片上传

- 生图入口在节点按钮和右键菜单中，位于脑爆扩展旁边。
- 每次可生成 1 到 10 张图片，后端并发生成并逐张流式返回。
- 生图预设包含角色、分镜、影视关键帧、场景、商业、封面、风格、材质和品牌方向。
- 图片节点可以继续生图扩展，方便做角色变体、风格探索和参考图迭代。
- 如果当前节点或上游节点带有图片，后端会自动读取最多 4 张 `/api/media` 图片作为参考图。
- 上传图片支持 PNG、JPEG、WebP、GIF，单文件上限 25MB。

## 脑爆模式

内置模式定义在 [`backend/app/prompts/modes/`](backend/app/prompts/modes/)：

- `general`：通用脑暴
- `screenplay`：剧本创作
- `project`：项目灵感
- `art`：艺术创作

每个模式都是一个 YAML 文件，包含 `system_prompt` 和 `expansion_template`。新增模式时添加一个 `*.yaml` 即可。

## 本地开发

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

Vite 会把 `/api` 代理到 `http://localhost:8000`。

### 测试与构建

```bash
cd backend
python -m pytest

cd ../frontend
npm run build
```

## 部署到服务器

上传源码时不要上传本地 `.env`、数据库卷、媒体文件、`node_modules`、构建产物、测试截图或本地压缩包。服务器上执行：

```bash
cp .env.example .env
# 编辑 .env
docker compose up -d --build
```

Docker Compose 会创建：

- `db_data`：PostgreSQL 数据
- `media_data`：生成和上传的图片

前端 Nginx 已将上传体积限制设置为 25MB，与后端图片上传上限保持一致。

## 隐私与安全

- API Key 只在后端读取和保存，`/api/config/providers` 只返回模型列表和可用状态。
- `.env`、运行时媒体、数据库卷、依赖目录和构建产物均已加入 `.gitignore`。
- 管理后台依赖 `ADMIN_PASSWORD`，生产环境不要使用默认值。
- `JWT_SECRET` 需要使用足够长的随机字符串。

## 已知限制

- 生图接口要求上游服务兼容 OpenAI images API；不同供应商对 `images.generate` / `images.edit` 的支持可能不完全一致。
- 图片参考目前只读取本项目 `/api/media` 下的图片节点，不会拉取任意外部图片 URL。
- 没有配置生图模型时，生图扩展面板会提示先到后台添加模型。
- 当前仓库尚未包含正式截图和许可证文件。

## 贡献

欢迎提交 issue 或 pull request。建议先用 Docker Compose 跑通完整链路，并在提交前确认：

```bash
python -m pytest
npm run build
```

## 许可证

当前仓库还没有添加许可证文件。发布或商用前请先补充明确的开源许可证。
