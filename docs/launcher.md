# 실행기 `bin/claude-proxy`

`claude-proxy` 명령 하나로 Docker 엔진, CLIProxyAPI, 프록시 라우터를 필요할 때만 구동하고 Claude Code를 라우터에 연결해 실행한다. 백엔드 전환은 실행 후 `/switch-backend`로 한다.

## 사용법

```bash
# 저장소 경로로 직접 실행
bin/claude-proxy

# PATH에 심볼릭 링크를 두고 실행 (실제 경로 기준으로 저장소 루트를 찾는다)
ln -s "$PWD/bin/claude-proxy" ~/.local/bin/claude-proxy
claude-proxy --resume
```

인자는 모두 그대로 `claude`에 전달된다.

## 실행 순서

| 순서 | 대상 | 동작 |
|---|---|---|
| 1 | Docker 엔진 | `docker info`가 실패하면 `open -a Docker` 후 제한 시간 안에서 폴링한다. |
| 2 | `cli-proxy-api` 컨테이너 | 실행 중이면 재사용, 멈춰 있으면 `docker start`, 일시 정지면 `docker unpause`, 없을 때만 `docker compose up -d --pull missing --no-recreate --no-deps cli-proxy-api`. compose가 실패해도(예: 다른 실행기가 동시에 만드는 중) 바로 끝내지 않고 준비 대기 결과로 판단한다. 이후 `http://127.0.0.1:8317/`이 HTTP 응답을 줄 때까지 기다린다. |
| 3 | 라우터 | `http://127.0.0.1:3456/admin/status`가 200이면 모드와 관계없이 재사용한다. 아니면 `CLAUDE_PROXY_MODE`에 따라 기동하고 200이 될 때까지 기다린다. |
| 4 | Claude Code | 아래 환경변수를 정리한 뒤 `exec claude "$@"`를 실행한다. |

매 실행마다 이미지 build, pull, 컨테이너 재생성을 하지 않는다. 실행기가 종료되어도 컨테이너와 라우터는 계속 실행된다.

Claude Code 실행 직전 환경변수 처리:

- 제거: `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`. GPT 전용 실행 설정이 전환 가능한 경로에 섞이지 않게 한다.
- 설정: `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.

## 라우터 모드

| 모드 | 기동 방식 |
|---|---|
| `container` (기본값) | `claude-proxy-router` 컨테이너가 있으면 `docker start`, 없으면 `docker compose up -d --pull missing --no-recreate --no-deps router`. 이미지가 없으면 이때 한 번 빌드된다. 새로 만들 때 `CLIPROXY_KEY`가 없으면 값 출력 없이 경고한다(gpt 백엔드 사용 불가). |
| `local` | `node src/index.js`를 별도 세션(`perl`의 `POSIX::setsid`)으로 백그라운드 실행한다. 터미널을 닫거나 Claude Code에서 Ctrl-C를 눌러도 라우터가 함께 종료되지 않는다. pid는 `proxy.pid`, 로그는 `proxy.log`(저장소 루트)에 남긴다. 자세한 규칙은 아래를 본다. |

로컬 모드 규칙:

- 확인과 기동은 `proxy.lock` 디렉터리 잠금(`mkdir`) 안에서 한다. 동시에 실행한 실행기는 잠금을 기다린 뒤 이미 뜬 라우터를 재사용한다. 잠금 소유 프로세스가 없으면 오래된 잠금으로 보고 지운다. 대기 시간은 `CLAUDE_PROXY_READY_TIMEOUT`을 따른다.
- `proxy.pid`의 프로세스가 살아 있고 명령이 이 저장소의 `src/index.js`인데 상태 확인이 실패하면 두 번째 인스턴스를 띄우지 않고 오류로 끝낸다. 죽은 pid나 다른 프로세스의 pid가 남아 있으면 덮어쓴다.
- 기동 중 node 프로세스가 종료되면 제한 시간을 기다리지 않고 바로 오류로 끝낸다.

`--no-deps`를 쓰는 이유: 실행기가 CLIProxyAPI를 이미 확인했고, 이전 전에는 기존 `cli-proxy-api` 컨테이너가 다른 compose 프로젝트(`cliproxyapi`)에 속해 있어 의존 서비스를 새로 만들면 고정된 `container_name`이 충돌한다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `CLAUDE_PROXY_MODE` | `container` | `container` 또는 `local` |
| `CLAUDE_PROXY_ROUTER_URL` | `http://127.0.0.1:3456` | 라우터 주소. `ANTHROPIC_BASE_URL`에도 쓰인다. |
| `CLIPROXY_HEALTH_URL` | `http://127.0.0.1:8317/` | CLIProxyAPI 응답 확인 주소 |
| `CLIPROXY_DIR` | `services/CLIProxyAPI` | CLIProxyAPI 저장소 경로(상대 경로는 저장소 루트 기준). compose `include` 대상 |
| `ROUTER_CLIPROXY_BASE_URL` | `http://cli-proxy-api:8317` | 라우터 컨테이너가 CLIProxyAPI에 접속할 주소(compose에서 사용) |
| `CLAUDE_PROXY_DOCKER_TIMEOUT` | `120` | Docker 엔진 기동 대기 시간(초) |
| `CLAUDE_PROXY_READY_TIMEOUT` | `60` | CLIProxyAPI와 라우터 준비 대기 시간(초) |
| `CLAUDE_PROXY_POLL_INTERVAL` | `1` | 폴링 간격(초) |
| `DOCKER_BIN`, `CURL_BIN`, `OPEN_BIN`, `NODE_BIN`, `CLAUDE_BIN` | `docker`, `curl`, `open`, `node`, `claude` | 사용할 실행 파일. 테스트에서 스텁으로 바꿔 쓴다. |

라우터 컨테이너에는 `CLIPROXY_KEY`, `MINIMAX_API_KEY`, `KIMI_API_KEY`가 compose를 실행한 셸에서 이름만으로 전달된다. 파일에 값을 적지 않는다. `config.json`은 읽기 전용으로 마운트되며, 파일이 없으면 compose가 오류를 낸다.

## 서비스 중지

```bash
# 라우터 (컨테이너 모드)
docker stop claude-proxy-router

# 라우터 (로컬 모드)
kill "$(cat proxy.pid)"

# CLIProxyAPI
docker stop cli-proxy-api
```

`docker compose down`은 CLIProxyAPI 컨테이너까지 제거하므로 필요할 때만 쓴다.

`proxy.lock`이 남아 실행이 멈추면, 다른 실행기가 기동 중이 아닌지 확인한 뒤 `rm -rf proxy.lock`으로 지운다.

## 컨테이너 설정 갱신

`docker start`는 컨테이너를 만들 때 들어간 환경변수를 그대로 쓴다. 폴더 이전 후, `ROUTER_CLIPROXY_BASE_URL`을 바꾼 후, 키를 교체한 후에는 라우터 컨테이너를 다시 만든다.

```bash
docker compose up -d --force-recreate --no-deps router
```

`src/`를 바꾼 뒤 이미지를 새로 만들 때는 `--build`를 더한다.

## CLIProxyAPI 포트

`compose/cli-proxy-api.override.yml`은 upstream이 모든 인터페이스에 게시하는 포트(8317, 8085, 1455, 54545, 51121, 11451)를 `127.0.0.1`로만 게시하도록 덮어쓴다. 8317은 API, 나머지는 로컬 브라우저에서 접근하는 OAuth 콜백 포트다. 이 설정은 compose로 컨테이너를 새로 만들 때 적용되며, 이전 전 `cliproxyapi` 프로젝트 컨테이너에는 적용되지 않는다.

## 폴더 이전 전 주의

컨테이너 모드는 `compose.yaml`이 `services/CLIProxyAPI/docker-compose.yml`을 `include`하므로 폴더 이전(계획 5단계)이 끝나야 그대로 동작한다. 이전 전에는 다음 중 하나를 쓴다.

- `CLAUDE_PROXY_MODE=local`로 라우터를 로컬 node로 실행한다. 기존 `cli-proxy-api` 컨테이너는 그대로 재사용된다.
- `CLIPROXY_DIR=/Users/mscho/development/study/CLIProxyAPI`를 지정한다. 이때 기존 컨테이너는 `cliproxyapi` 네트워크에 있어 라우터 컨테이너가 `cli-proxy-api` 이름을 찾지 못한다. `ROUTER_CLIPROXY_BASE_URL=http://host.docker.internal:8317`도 함께 지정한다.

`CLIPROXY_DIR` 위치에 `docker-compose.yml`과 `.env`가 없으면 실행기는 compose를 호출하기 전에 오류로 끝난다.

## 테스트

```bash
node --test test/launcher.test.js
```

스텁 `docker`, `curl`, `open`, `node`, `claude`를 임시 디렉터리에 두고 실행하므로 실제 Docker와 네트워크에 접근하지 않는다.
