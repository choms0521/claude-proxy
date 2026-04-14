# Claude Proxy Router

Claude Code 세션 중간에 Anthropic 호환 API 백엔드를 실시간 전환할 수 있는 로컬 프록시 서버.
외부 의존성 없이 순수 Node.js로 구현.

## 아키텍처

```
Claude Code  -->  Proxy (localhost:3456)  -->  Claude API (api.anthropic.com)
                       |                 -->  MiniMax API (api.minimax.io/anthropic)
                       |
                  /admin/switch 로
                  런타임 백엔드 전환
```

## Proxy가 처리하는 것

| 기능 | 설명 |
|------|------|
| API 키 교체 | 백엔드별 API 키를 `x-api-key` 헤더에 주입. `apiKey: null`이면 원본 패스스루 |
| 모델명 매핑 | `modelMapping` 설정 시 요청 body의 `model` 필드를 자동 교체 |
| Thinking 블록 제거 | 백엔드 전환 시 서명 충돌 방지를 위해 대화 히스토리에서 thinking 블록 자동 제거 |
| SSE 스트리밍 | `pipe()` 기반으로 스트리밍 응답을 버퍼링 없이 전달 |
| URL 경로 조합 | `baseUrl + path` 방식으로 백엔드 경로를 올바르게 조합 |

## 요구사항

- Node.js 18+

## 설치 및 설정

### 1. 프로젝트 클론

```bash
git clone <repo-url> claude-proxy
cd claude-proxy
```

### 2. 환경변수 설정 (~/.zshrc)

```bash
# MiniMax API 키
export MINIMAX_API_KEY=your-minimax-api-key

# Proxy URL
export CLAUDE_PROXY_URL=http://localhost:3456

# Proxy 경유 실행용 alias
alias claude-proxy='ANTHROPIC_BASE_URL=$CLAUDE_PROXY_URL CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 claude'
```

```bash
source ~/.zshrc
```

### 3. Claude Code 스킬 등록

`~/.claude/commands/switch-backend.md` 파일을 생성하면 `/switch-backend` 명령으로 전환 가능.
`skill/switch-backend.md` 참고.

## 사용법

### Proxy 시작

```bash
cd claude-proxy && npm start
```

### Claude Code 실행

```bash
claude-proxy    # Proxy 경유 (백엔드 전환 가능)
claude          # 직접 연결 (기존 방식)
```

### 백엔드 전환 (세션 중)

Claude Code 안에서 `/switch-backend` 스킬 사용:

```
/switch-backend           # 현재 상태 + 가용 백엔드 목록
/switch-backend minimax   # MiniMax로 전환
/switch-backend claude    # Claude로 복귀
```

또는 직접 curl:

```bash
# 전환
curl -s -X POST http://localhost:3456/admin/switch \
  -H "Content-Type: application/json" \
  -d '{"backend":"minimax"}'

# 상태 확인
curl -s http://localhost:3456/admin/status | jq .
```

> 전환은 **다음 턴**부터 적용된다. 현재 턴은 기존 모델이 응답.

## 백엔드 설정 (config.json)

```json
{
  "port": 3456,
  "activeBackend": "claude",
  "backends": {
    "claude": {
      "name": "Claude API",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": null
    },
    "minimax": {
      "name": "MiniMax API",
      "baseUrl": "https://api.minimax.io/anthropic",
      "apiKey": "${MINIMAX_API_KEY}",
      "modelMapping": "MiniMax-M2.7"
    }
  }
}
```

### 설정 필드

| 필드 | 필수 | 설명 |
|------|------|------|
| `name` | O | 표시용 백엔드 이름 |
| `baseUrl` | O | API 엔드포인트 기본 URL. 요청 path가 이 뒤에 붙음 (`baseUrl + /v1/messages`) |
| `apiKey` | O | API 키. `null`이면 클라이언트가 보낸 원본 키 패스스루. `${ENV_VAR}` 형식으로 환경변수 참조 가능 |
| `modelMapping` | X | 설정 시 요청 body의 `model` 필드를 이 값으로 교체. Claude Code가 보내는 `claude-opus-4-6` 등을 백엔드에 맞게 변환 |

### 새 백엔드 추가

`config.json`의 `backends`에 항목 추가 후 Proxy 재시작:

```json
"new-backend": {
  "name": "New Backend",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "${NEW_BACKEND_API_KEY}",
  "modelMapping": "target-model-name"
}
```

## 프로젝트 구조

```
claude-proxy/
├── package.json          # ESM, 외부 의존성 없음
├── config.json           # 백엔드 정의
├── .gitignore            # node_modules, .env 제외
├── src/
│   ├── index.js          # 진입점 (.env 로딩 -> config 로딩 -> 서버 시작)
│   ├── server.js         # HTTP 서버. /admin/* -> admin, 나머지 -> proxy
│   ├── proxy.js          # 핵심 프록시 로직 (모델 매핑, thinking 제거, SSE 포워딩)
│   ├── admin.js          # Admin API 핸들러 (status, switch)
│   ├── config.js         # config.json 로딩, 환경변수 치환, 불변 상태 관리
│   └── utils.js          # sendJson, readBody, log 헬퍼
└── skill/
    └── switch-backend.md # Claude Code 스킬 정의
```

## Admin API

| 엔드포인트 | 메서드 | 요청 | 응답 |
|-----------|--------|------|------|
| `/admin/status` | GET | - | `{activeBackend, availableBackends[]}` |
| `/admin/switch` | POST | `{"backend":"minimax"}` | `{activeBackend, previousBackend, changed}` |

## 주의사항

- Proxy 재시작 시 activeBackend는 `config.json`의 기본값(`claude`)으로 초기화됨
- 백엔드 전환 중 진행 중인 요청은 전환 전 백엔드로 완료됨 (race condition 안전)
- thinking 블록 제거는 `/messages` 엔드포인트에서만 동작
- Claude 백엔드는 `apiKey: null` 설정으로 Claude Code의 원래 인증을 패스스루
