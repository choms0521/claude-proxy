# claude-proxy 통합 계획

상태: 승인됨(2026-09-23). 라우터 기본 모드는 컨테이너, CLIProxyAPI `config.yaml` alias 추가 승인, `.zshrc` `claude-proxy` alias 교체 승인. 5단계 폴더 이전은 실행 직전에 다시 확인한다.

## 목표

1. `claude-proxy` 명령 하나로 Claude Code를 실행하고, 백엔드(claude / gpt / minimax / kimi)를 `/switch-backend`로 수동 전환한다.
2. 실행기가 Docker Desktop, CLIProxyAPI 컨테이너, 라우터를 필요할 때만 구동하고 준비 확인 후 Claude Code를 실행한다.
3. CLIProxyAPI 폴더를 `.git` 포함 통째로 `services/CLIProxyAPI`로 옮긴다. Git 이력은 저장소별로 유지한다.

## 확정된 결정

| 항목 | 결정 |
|---|---|
| 자동 구동 범위 | Docker Desktop이 꺼져 있으면 `open -a Docker` 후 `docker info` 폴링 |
| 라우터 구동 | 컨테이너 모드와 로컬 node 모드 둘 다 지원 |
| 작업 순서 | 인증 헤더 수정을 별도 커밋으로 먼저 |
| 기준 브랜치 | 현재 `feat/add-kimi-and-refactor-switch-backend` |
| 폴더 이전 시점 | 코드 준비 후 사용자에게 다시 확인 |
| 기본 백엔드 | `claude` (전환은 프로세스 전역, 재시작 시 기본값 복귀) |

## 기존 환경 (읽기 전용 확인 결과)

- `cli-proxy-api` 컨테이너: compose 프로젝트 `cliproxyapi`, 작업 디렉터리 `/Users/mscho/development/study/CLIProxyAPI`, `restart: unless-stopped`, healthcheck 없음, `pull_policy: always`.
- bind mount: `config.yaml`, `logs`, `plugins`는 옛 절대 경로. 인증은 `.env`의 `CLI_PROXY_AUTH_PATH`로 `~/.cli-proxy-api`를 가리키며 저장소 밖에 있다. named volume 없음.
- 라우터: 컨테이너 파일 없음, `:3456` 미기동. 테스트 도구 없음(Node 18 이상).
- `.zshrc:169`에 `claude-proxy` alias가 이미 있어 새 실행기가 이를 대체해야 한다. `claude-gpt`(`.zshrc:174`)는 검증 완료 전까지 유지한다.
- CLIProxyAPI는 외부 upstream 저장소(router-for-me)이므로 그 안의 파일은 수정하지 않는다.

## 단계

### 1단계: 인증 헤더 분리 (보안, 별도 커밋)

- 문제: `src/proxy.js` `buildHeaders`가 클라이언트 `authorization`을 유지한 채 `x-api-key`만 덮어쓴다. 현재도 minimax·kimi로 전환하면 Claude OAuth bearer가 외부로 전달될 수 있다.
- 수정: 백엔드 설정에 `forwardClientAuth: true`(실제 Claude 백엔드만)를 둔다. 그 외 백엔드는 `authorization`, `x-api-key`, `cookie` 등 클라이언트 인증 헤더를 모두 제거하고, 해당 백엔드의 키만 주입한다.
- 테스트: `node:test`로 회귀 테스트를 추가하고 `npm test` 스크립트를 등록한다. 실제 인증을 사용한 호출은 하지 않는다.
- 이 커밋 전까지 minimax·kimi 전환을 쓰지 않는다.

### 2단계: GPT(CLIProxyAPI) 백엔드

- `config.example.json`, `config.json`에 `gpt` 백엔드를 추가한다. `baseUrl: ${CLIPROXY_BASE_URL}`(로컬 `http://127.0.0.1:8317`, 컨테이너 `http://cli-proxy-api:8317`), `apiKey: ${CLIPROXY_KEY}`.
- 환경변수 치환은 백엔드 사용 시점 지연 평가로 바꾼다. 키가 없으면 해당 백엔드만 사용 불가로 표시하고 라우터는 기동한다.
- `modelMapping`은 쓰지 않고 `claude-*` 모델 ID를 그대로 넘긴다. CLIProxyAPI alias 표가 tier별로 매핑한다.
- CLIProxyAPI `config.yaml`(gitignore 대상, 사용자 로컬)에 `claude-opus-5-5` 등 최신 ID alias 추가가 필요하다. 별도 승인 후 백업을 만들고 수정한다.
- `skill/switch-backend.md`와 설치된 스킬에 gpt 안내를 반영한다.

### 3단계: 실행기 `bin/claude-proxy`

1. `docker info`가 실패하면 `open -a Docker` 후 제한 시간 안에서 폴링한다.
2. `cli-proxy-api` 컨테이너가 실행 중이면 재사용한다. 멈춰 있으면 `docker start`만 한다. 컨테이너가 없을 때만 `compose up -d --pull missing`을 쓴다. 매 실행마다 build, recreate, pull을 하지 않는다.
3. 라우터: `CLAUDE_PROXY_MODE=container|local`(기본값은 컨테이너). `/admin/status` 응답이 있으면 재사용하고, 없으면 기동한 뒤 준비를 확인한다. 로컬 모드는 pid 파일과 로그 파일을 쓴다.
4. `ANTHROPIC_BASE_URL=http://localhost:3456`만 설정하고 `exec claude "$@"`를 실행한다. GPT 전용 `ANTHROPIC_MODEL`, `ANTHROPIC_AUTH_TOKEN`은 고정하지 않는다.
5. 종료 시 공용 컨테이너와 라우터는 유지한다.

- `.zshrc:169` alias는 실행기 경로로 교체한다(사용자 승인 후).

### 4단계: 라우터 컨테이너화와 상위 compose

- 라우터 `Dockerfile`과 상위 `compose.yaml`을 추가한다. 상위 compose는 `include`로 `services/CLIProxyAPI/docker-compose.yml`을 불러와 같은 네트워크를 쓴다.
- 공식 문서 확인 결과(Compose v5.3):
  - `include`로 불러온 하위 파일의 상대 경로와 `.env`는 하위 파일 디렉터리 기준으로 해석된다. 알려진 버그(docker/compose#11577)가 있으므로 `env_file`은 명시적으로 지정한다.
  - 상위 `services:`에 같은 이름의 서비스를 다시 정의해도 병합되지 않는다(경고만 출력). 속성을 덮어쓰려면 `include: - path: [하위 파일, 덮어쓰기 파일]` 형식을 쓴다. 덮어쓰기 파일은 상위 저장소에 둔다.
  - 프로젝트 이름은 상위(`claude-proxy`)로 바뀌지만 `container_name: cli-proxy-api`는 그대로 유지된다. 따라서 5단계 이전 시 기존 `cliproxyapi` 프로젝트 컨테이너를 먼저 제거해야 한다.
  - `pull_policy: always`는 `up`마다 pull하고 이미지가 바뀌면 컨테이너를 다시 만든다. `up --pull missing`은 이를 덮어쓴다. `docker compose start`는 pull하지 않는다.
  - `up --wait`는 healthcheck가 없는 서비스는 running 상태만 기다린다. 실행기는 HTTP 응답으로 준비 여부를 직접 확인한다.
- 라우터 컨테이너는 `PROXY_HOST=0.0.0.0`으로 실행하고 포트는 `127.0.0.1:3456:3456`으로만 게시한다.
- 상위 `.gitignore`에 `services/CLIProxyAPI/`를 추가한다.

### 5단계: 폴더 이전 (사용자 재확인 후 실행)

1. 열린 `claude-gpt` 세션이 없는지 확인한다.
2. `config.yaml`, `.env`, `~/.cli-proxy-api`를 백업한다.
3. 옛 디렉터리에서 `docker compose stop` 후 `rm`을 실행한다. `down -v`, prune, 인증 삭제는 하지 않는다.
4. `mv`로 `services/CLIProxyAPI`로 옮긴다.
5. 새 위치에서 컨테이너를 다시 만들고(`--pull missing`), 마운트 경로와 `:8317` 응답을 확인한다.
6. `.zshrc`의 `claude-gpt` 경로 의존을 점검한다.

## 검증

- 단위: 헤더 분리 테스트, 지연 치환 테스트(`npm test`).
- 통합: 실행기를 Docker 꺼짐, 컨테이너 멈춤, 라우터 꺼짐 상태에서 각각 실행해 자동 구동을 확인한다.
- 실호출: 인증 분리 커밋 후에만 claude → gpt → claude 전환 왕복을 확인한다(tool history 포함).
- 각 단계는 executor가 구현하고, 검토는 별도 verifier/code-reviewer 패스로 한다.

## 위험

| 위험 | 대응 |
|---|---|
| 이전 중 `claude-gpt` 세션 끊김 | 5단계 직전에 재확인 |
| `pull_policy: always`로 인한 의도치 않은 이미지 갱신 | 실행기에서 `--pull missing` 사용, 기존 컨테이너 재사용 |
| compose `include`로 프로젝트 이름이 바뀜 | 4단계에서 문서 확인 후 방식 확정 |
| 전역 전환이 다른 세션에 영향 | README와 스킬에 명시 |

## 진행 기록

| 날짜 | 단계 | 결과 |
|---|---|---|
| 2026-09-23 | 1단계 | `76090a8` 인증 헤더 분리. 보안 검토에서 우회 경로 없음 확인 |
| 2026-09-23 | 1단계 후속 | `9c188e6` 라우터 기본 수신 주소를 127.0.0.1로 변경, `/admin/switch`에 Origin 거부와 JSON Content-Type 요구(보안 검토 HIGH·MEDIUM) |
| 2026-09-23 | 2단계 일부 | CLIProxyAPI `config.yaml`에 `claude-opus-5-5 -> gpt-6-astra` alias 추가(백업 `config.yaml.bak-20260923-150756`), 핫 리로드 확인 |
| 2026-09-23 | 2단계 | `93898f7` gpt 백엔드 추가, `${VAR:-default}` 지원, 환경변수 누락 백엔드는 사용 불가로 표시 |
| 2026-09-23 | 3·4단계 | `63e4764` 실행기, 라우터 Dockerfile, 상위 compose. 코드 리뷰 HIGH(로컬 라우터 분리) 등 반영 |
| 2026-09-23 | 3단계 후속 | `~/.zshrc`의 `claude-proxy` alias를 `CLAUDE_PROXY_MODE=local` 실행기로 교체(백업 `~/.zshrc.bak-20260923-153435`) |
| 2026-09-23 | 모델 목록 | `a140068` 요청 모델 기준 라우팅과 `/model` 목록 주입, `469bae9` GPT 7종, `d1518d3` Origin·Host·Content-Type 검사와 목록 allowlist, MiniMax M3·Kimi K3 목록 추가 |

### 남은 확인 사항

- 실제 모델 호출로 claude → gpt → claude 왕복과 tool history 확인.
- 5단계 이전 후 컨테이너 모드 실구동 확인, 이후 alias에서 `CLAUDE_PROXY_MODE=local` 제거.
- `/model`에서 Enter로 GPT·MiniMax·Kimi 모델을 고르면 사용자 기본 모델로 저장되어 일반 `claude`가 실패한다. `s`(이 세션만)를 쓴다. 불편하면 `ConfigChange` hook으로 되돌리는 방안을 검토한다.
- minimax·kimi가 `x-api-key`만으로 인증되는지 실호출 확인.

### 보류 항목 (보안 검토 LOW)

- 제3자 백엔드로 가는 식별 정보(`x-claude-code-session-id`, `x-stainless-*`, body `metadata.user_id`) 제거 검토.
- `forwardClientAuth: true`인 백엔드의 `baseUrl`이 `https:`가 아니면 설정 로드 시 오류 처리.
- hop-by-hop 헤더(`transfer-encoding`, `upgrade`, `te`, `trailer`, `proxy-connection`) 제거.
- 로컬 스텁 백엔드를 쓰는 통합 테스트로 `authorization` 미전달 확인.
- minimax·kimi가 `x-api-key`만으로 인증되는지 실호출로 확인(1단계 이후 `Authorization`은 전달하지 않음).
