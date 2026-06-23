# Vibe Brainstorm — AI 无限画布脑爆平台

在无限画布上添加节点，让大模型对节点做**灵感发散**，一次延伸出多个子节点。支持**剧本创作 / 项目灵感 / 艺术创作 / 通用**等脑爆模式，用户自选。前后端分离，docker-compose 一键部署，后端集中管理大模型 API 配置。

## 架构

```
浏览器 ─▶ frontend (nginx 托管静态 + 反代 /api) ─▶ backend (FastAPI) ─▶ PostgreSQL
                                                        └─▶ OpenAI / DeepSeek / 通义 / 智谱 / Ollama ...
```

- **前端**：React + Vite + TypeScript + [@xyflow/react](https://reactflow.dev/) + Zustand + elkjs
- **后端**：FastAPI + SQLAlchemy(async) + 官方 `openai` SDK（`base_url` 覆盖以兼容多家）
- **数据库**：PostgreSQL 17

## 快速开始

```bash
cp .env.example .env       # 填入至少一个 provider 的 API key
docker compose up --build  # 首次构建
```

打开 http://localhost:8080

健康检查：

```bash
curl localhost:8080/api/health           # {"status":"ok"}
curl localhost:8080/api/config/providers # 列出可用 provider（不含密钥）
```

## 配置大模型

密钥放在 `.env`（`OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` ...）。
provider 的 `base_url` 与可用模型在 [`backend/providers.yaml`](backend/providers.yaml) 定义，新增/修改 provider 改这里即可。后端只在内存里把密钥注入请求，**绝不下发给前端**。

## 部署到服务器

上传源码时不要上传本地 `.env`、数据库卷、媒体文件、`node_modules`、构建产物或测试截图。服务器上执行：

```bash
cp .env.example .env
# 编辑 .env：填 API Key，并修改 JWT_SECRET / ADMIN_PASSWORD / 数据库密码
docker compose up -d --build
```

默认 Web 端口由 `.env` 的 `APP_PORT` 控制；生成图片会持久化到 Docker volume `media_data`。

## 本地开发（不走 docker）

```bash
# 后端
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e . && uvicorn app.main:app --reload --port 8000

# 前端（另开一个终端）
cd frontend && npm install && npm run dev   # Vite 代理 /api -> localhost:8000
```

## 脑爆模式

内置模式定义在 [`backend/app/prompts/modes/`](backend/app/prompts/modes/)，每个 `*.yaml` 一种模式（system prompt + 发散模板）。新增模式加一个文件即可。
