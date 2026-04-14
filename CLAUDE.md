# Claude Code Proxy Router

## Project Overview

Claude Code Proxy Router — HTTP proxy that routes AI API requests to different backends (Claude API, MiniMax API, etc.) with a simple admin interface.

## Architecture

- `src/proxy.js` — Main proxy logic
- `src/index.js` — Entry point / server setup
- `config.json` — Backend configuration
- Admin API: `http://localhost:3456/admin/`

## Backends

- **claude** — Anthropic Claude API
- **minimax** — MiniMax API

## Admin Endpoints

- `GET /admin/status` — Current backend status
- `POST /admin/switch` — Switch backend (`{"backend":"minimax"}`)
- `POST /admin/reload` — Reload config

## Important Rules

### Chinese Characters Prohibition
**절대 한자(중국어 문자/중국식 표현)를 코드, 주석, 변수명, 문서에 사용하지 마십시오.**
Chinese characters are strictly prohibited in all project files — no Chinese characters in code, comments, variable names, or documentation.
