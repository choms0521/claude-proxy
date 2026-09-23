# Claude Proxy Router

Claude Code 세션 중간에 Anthropic 호환 API 백엔드를 실시간 전환할 수 있는 로컬 프록시 서버.
외부 의존성 없이 순수 Node.js로 구현.

## 아키텍처

```
Claude Code  -->  Proxy (localhost:3456)  -->  Claude API (api.anthropic.com)
                       |                 -->  GPT (CLIProxyAPI, 127.0.0.1:8317)
                       |                 -->  MiniMax API (api.minimax.io/anthropic)
                       |
                  /admin/switch 로
                  런타임 백엔드 전환
```

## Proxy가 처리하는 것

| 기능 | 설명 |
|------|------|
| API 키 교체 | 백엔드별 API 키를 `x-api-key` 헤더에 주입. `apiKey: null`이면 원본 패스스루 |
| 모델별 라우팅 | 요청 body의 `model`이 어떤 백엔드의 `models`에 있으면 활성 백엔드와 관계없이 그 백엔드로 보냄 |
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

# GPT 백엔드(CLIProxyAPI) 키와 접속 주소. CLIPROXY_BASE_URL은 생략 시 http://127.0.0.1:8317 사용
export CLIPROXY_KEY=your-cliproxyapi-key
export CLIPROXY_BASE_URL=http://127.0.0.1:8317

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
/switch-backend gpt       # GPT(CLIProxyAPI)로 전환
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

### `/model`에서 GPT 모델 선택

`bin/claude-proxy`로 실행하면 `/model` 목록에 `GPT-6 Astra`, `GPT-5.5` 행이 추가된다. 위 2단계의 `ANTHROPIC_BASE_URL=... claude` alias는 실행기를 거치지 않으므로 이 행이 나타나지 않는다. alias를 쓰려면 `alias claude-proxy='<저장소 경로>/bin/claude-proxy'`처럼 실행기를 가리키게 한다. 행을 고른 뒤 **Enter가 아니라 `s`** 를 눌러 이 세션에만 적용한다. Enter는 모든 세션의 기본 모델로 저장하므로 라우터를 거치지 않는 일반 `claude`가 깨진다.

GPT 모델을 고른 세션의 요청은 라우터가 body의 `model`을 보고 자동으로 GPT 백엔드로 보낸다. `/switch-backend`는 필요 없다. Claude Code가 백그라운드로 보내는 Haiku 요청은 계속 활성 백엔드(기본값 Claude)로 간다. `/switch-backend`는 `claude-*` 요청 전체를 minimax, kimi 같은 백엔드로 전역 전환할 때 쓴다. 자세한 내용은 [docs/launcher.md](docs/launcher.md)를 본다.

> `/admin/switch`는 `Content-Type: application/json` 요청만 받고, `Origin` 헤더가 있는 요청(브라우저에서 보낸 요청)은 403으로 거부한다.

### 수신 주소

라우터는 기본적으로 `127.0.0.1`에서만 수신한다. 컨테이너 안에서 실행할 때처럼 다른 주소가 필요하면 `PROXY_HOST` 환경변수나 `config.json`의 `host` 필드로 바꾼다(환경변수가 우선).

### 요청 검사

웹 페이지가 라우터를 거쳐 백엔드 키를 쓰지 못하도록, 모든 경로(`/admin/*` 포함)에서 요청을 먼저 검사한다. Claude Code의 일반 요청(JSON, `Origin` 없음, `Host: 127.0.0.1:<포트>`)은 그대로 통과한다.

| 조건 | 응답 |
|------|------|
| `Origin` 헤더가 있음 | 403 |
| `Host`가 `127.0.0.1:<포트>`, `localhost:<포트>`, `[::1]:<포트>`, `PROXY_ALLOWED_HOSTS` 중 하나가 아님 (DNS 리바인딩 차단) | 403 |
| `POST`, `PUT`, `PATCH`의 `Content-Type`이 `application/json`이 아님 | 415 |
| 요청 body가 32 MiB를 넘음 | 413 |

`<포트>`는 요청을 받은 라우터 포트다. 컨테이너 모드는 `127.0.0.1:3456:3456`으로 게시하므로 추가 설정이 필요 없다. 다른 이름으로 접근해야 하면 `PROXY_ALLOWED_HOSTS=claude-proxy-router:3456,other:3456`처럼 쉼표로 구분한 `host:port` 목록을 지정한다.

## 백엔드 설정 (config.json)

```json
{
  "port": 3456,
  "activeBackend": "claude",
  "backends": {
    "claude": {
      "name": "Claude API",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": null,
      "forwardClientAuth": true
    },
    "minimax": {
      "name": "MiniMax API",
      "baseUrl": "https://api.minimax.io/anthropic",
      "apiKey": "${MINIMAX_API_KEY}",
      "modelMapping": "MiniMax-M2.7"
    },
    "gpt": {
      "name": "GPT (CLIProxyAPI)",
      "baseUrl": "${CLIPROXY_BASE_URL:-http://127.0.0.1:8317}",
      "apiKey": "${CLIPROXY_KEY}",
      "models": [
        { "id": "gpt-6-astra", "label": "GPT-6 Astra" },
        { "id": "gpt-5.5", "label": "GPT-5.5" }
      ]
    }
  }
}
```

### 설정 필드

| 필드 | 필수 | 설명 |
|------|------|------|
| `name` | O | 표시용 백엔드 이름 |
| `baseUrl` | O | API 엔드포인트 기본 URL. 요청 path가 이 뒤에 붙음 (`baseUrl + /v1/messages`) |
| `apiKey` | O | API 키. `null`이면 클라이언트가 보낸 원본 키 패스스루(단, `forwardClientAuth`가 `true`인 백엔드에서만). `${ENV_VAR}` 형식으로 환경변수 참조 가능 |
| `modelMapping` | X | 설정 시 요청 body의 `model` 필드를 이 값으로 교체. Claude Code가 보내는 `claude-opus-4-6` 등을 백엔드에 맞게 변환 |
| `models` | X | `{ "id", "label", "description"? }` 배열. 요청 body의 `model`이 `id`와 정확히 일치하면 활성 백엔드 대신 이 백엔드로 보낸다. 이렇게 고른 요청에는 `modelMapping`을 적용하지 않고 `id`를 그대로 보낸다. 여러 백엔드에 같은 `id`가 있으면 설정 파일 순서상 먼저 나온 백엔드를 쓰고, 설정을 읽을 때 경고 로그를 남긴다. 일치한 백엔드가 사용 불가면 503을 돌려준다. `/admin/model-picker`의 `/model` 행 목록에도 쓰인다. `label`이 없으면 `id`를 쓴다 |
| `forwardClientAuth` | X | `true`이면 클라이언트가 보낸 인증 헤더(`authorization`, `x-api-key`, `proxy-authorization`, `cookie`)를 그대로 백엔드에 전달. 기본값은 `false`이며, 이 경우 위 헤더를 모두 제거한 뒤 `apiKey`가 있으면 `x-api-key`로 주입. 실제 Claude API 백엔드에만 `true`를 설정해 Claude Code의 OAuth 토큰이 제3자 백엔드로 유출되지 않도록 한다 |

### 환경변수 치환과 관용적 가용성 판정

`baseUrl`, `apiKey` 값에는 `${VAR}`와 `${VAR:-default}` 두 형식을 쓸 수 있다.

- `${VAR}`: 환경변수 `VAR`의 값을 그대로 사용. `VAR`이 설정되지 않으면 해당 백엔드만 사용 불가로 표시된다.
- `${VAR:-default}`: `VAR`이 설정되어 있으면 그 값을, 없으면 `default`를 사용. `gpt` 백엔드의 `baseUrl`이 이 형식을 쓴다.

필수 환경변수가 없다고 해서 라우터 전체가 기동에 실패하지는 않는다(관용적 평가: 설정 로딩 시점에 백엔드별로 판정하며, 실패한 백엔드만 사용 불가로 표시하고 나머지는 정상 동작). 대신 그 백엔드는 `/admin/status`에서 `available: false`와 `unavailableReason`으로 표시되고, `/admin/switch`가 해당 백엔드로의 전환을 거부한다. 단, `config.json`의 기본 `activeBackend` 자체가 사용 불가 상태이면 그때는 라우터 기동이 명확한 오류 메시지와 함께 실패한다. `unavailableReason`에는 환경변수 이름만 담기며 실제 키 값은 절대 포함되지 않는다. 빈 문자열(`""`)로 설정된 환경변수는 미설정과 동일하게 취급한다(셸의 `${VAR:-default}` 관례와 동일).

`gpt` 백엔드(CLIProxyAPI 연동)는 `CLIPROXY_KEY` 환경변수가 설정되어 있어야 사용 가능하다. `CLIPROXY_BASE_URL`은 생략하면 `http://127.0.0.1:8317`을 기본값으로 쓴다. `modelMapping`을 지정하지 않으므로 Claude Code가 보내는 `claude-*` 모델 ID가 그대로 전달되며, 티어별 매핑은 CLIProxyAPI 쪽 alias 설정이 담당한다. `models`에 적은 `gpt-6-astra`, `gpt-5.5`는 CLIProxyAPI alias 표의 `fork: true` 설정 덕분에 원래 이름 그대로도 받아들여진다. `forwardClientAuth`도 지정하지 않아 Claude OAuth 토큰이 전달되지 않고, 라우터가 주입하는 `x-api-key`만 CLIProxyAPI로 전달된다.

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
│   ├── routing.js        # 요청 body의 model로 백엔드 선택
│   ├── admin.js          # Admin API 핸들러 (status, switch, model-picker)
│   ├── config.js         # config.json 로딩, 환경변수 치환, 불변 상태 관리
│   └── utils.js          # sendJson, readBody, log 헬퍼
└── skill/
    └── switch-backend.md # Claude Code 스킬 정의
```

## Admin API

| 엔드포인트 | 메서드 | 요청 | 응답 |
|-----------|--------|------|------|
| `/admin/status` | GET | - | `{activeBackend, availableBackends[]}` (각 항목에 `available`, `models`, 비가용 시 `unavailableReason` 포함) |
| `/admin/model-picker` | GET | - | Claude Code 설정 JSON `{"modelPicker":{"options":[...]}}`. 사용 가능한 백엔드의 `models`만 담고, 각 행 설명에 `s`를 누르라는 안내가 들어간다 |
| `/admin/switch` | POST | `{"backend":"minimax"}` | `{activeBackend, previousBackend, changed}` |

## 주의사항

- 백엔드 전환은 라우터 프로세스 전체에 전역으로 적용됨(세션별 분리 없음). 단, body의 `model`이 어떤 백엔드의 `models`에 있는 요청은 활성 백엔드와 관계없이 그 백엔드로 가므로, `/model`로 GPT 모델을 고른 세션만 GPT를 쓸 수 있다. Proxy 재시작 시 activeBackend는 `config.json`의 기본값(`claude`)으로 초기화됨
- 백엔드 전환 중 진행 중인 요청은 전환 전 백엔드로 완료됨 (race condition 안전)
- thinking 블록 제거는 `/messages` 엔드포인트에서만 동작
- Claude 백엔드는 `apiKey: null` 설정으로 Claude Code의 원래 인증을 패스스루
