# AI 에이전트로 GPT 백엔드 설정하기

이 문서를 AI 코딩 에이전트(Claude Code 등)에게 맡기면 claude-proxy에서 GPT 모델을 쓰기 위한 설정을 한 번에 끝낼 수 있다. 사람이 할 일은 요청 한 줄과 브라우저에서 Codex(ChatGPT) 계정으로 로그인하는 것뿐이다.

GPT 백엔드는 외부 저장소인 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)가 필요하다. CLIProxyAPI는 ChatGPT 구독(Codex OAuth)으로 GPT 모델을 Anthropic 호환 API로 제공하고, claude-proxy 라우터는 GPT 모델 요청을 이 서버로 보낸다. 사람이 직접 설정하려면 [README의 GPT 백엔드 준비](../README.md#gpt-백엔드-준비-cliproxyapi)를 따른다.

## 사용 방법

claude-proxy 저장소 루트에서 Claude Code를 열고 다음과 같이 요청한다.

```text
docs/ai-setup.md를 읽고 "에이전트 절차"를 순서대로 실행해서 GPT 백엔드를 설정해 줘.
```

에이전트가 Codex 로그인 단계에서 명령 하나를 실행해 달라고 요청하면, 그 명령을 실행하고 브라우저에서 로그인한다.

## 설정이 끝나면 되는 것

- `services/CLIProxyAPI`에 CLIProxyAPI가 설치되고 `cli-proxy-api` 컨테이너가 `127.0.0.1:8317`에서 실행된다.
- `~/.zshrc`에 `CLIPROXY_KEY`와 `claude-proxy` alias가 등록된다.
- `claude-proxy`로 실행한 Claude Code의 `/model` 목록에 GPT 모델이 나타난다.

## 요구사항

- macOS, Docker Desktop, Node.js 18 이상, Git
- `jq` 또는 `python3`(실행기가 모델 목록을 검사할 때 사용)
- ChatGPT 구독 계정(Codex 로그인용)

---

## 에이전트 절차

이 절은 AI 에이전트가 따르는 지침이다. 모든 명령은 claude-proxy 저장소 루트(`REPO`)에서 실행한다고 가정한다.

### 지켜야 할 규칙

- API 키, 토큰, `config.yaml`의 `api-keys` 값을 출력하거나 로그에 남기지 않는다. 값은 파일에 바로 쓰고, 확인할 때는 "설정됨" 여부만 본다.
- 이미 있는 파일(`services/CLIProxyAPI/config.yaml`, `.env`, `config.json`)을 덮어쓰지 않는다. 있으면 필요한 항목만 확인하고 고친다.
- `~/.zshrc`를 고치기 전에 `~/.zshrc.bak-<날짜시각>`으로 백업한다. 같은 항목이 이미 있으면 추가하지 않는다.
- `docker compose down -v`, `docker system prune`, 인증 디렉터리 삭제를 하지 않는다.
- 이미 실행 중인 `cli-proxy-api` 컨테이너가 있으면 멈추거나 지우지 말고, 1단계의 안내대로 사용자에게 먼저 묻는다.
- 단계가 실패하면 원인을 보고하고 멈춘다. 임의로 우회하지 않는다.

### 1단계: 현재 상태 확인

다음을 확인하고 결과를 짧게 정리한다.

```bash
docker info --format '{{.ServerVersion}}'          # 실패하면 open -a Docker 후 다시 확인
node -v                                            # 18 이상
command -v jq || command -v python3
docker inspect --type container -f '{{.State.Status}} {{index .Config.Labels "com.docker.compose.project.working_dir"}}' cli-proxy-api 2>/dev/null
ls services/CLIProxyAPI 2>/dev/null | head -3
[ -n "$CLIPROXY_KEY" ] && echo "CLIPROXY_KEY set" || echo "CLIPROXY_KEY missing"
ls config.json 2>/dev/null || echo "config.json missing"
```

- `config.json`이 없으면 `cp config.example.json config.json`으로 만든다.
- `cli-proxy-api` 컨테이너가 이미 있고 작업 디렉터리가 `REPO/services/CLIProxyAPI`가 아니면, 사용자에게 두 가지 중 하나를 고르게 한다.
  - 기존 컨테이너 재사용: 2~5단계를 건너뛴다. 기존 CLIProxyAPI `config.yaml`의 `api-keys` 중 하나를 `CLIPROXY_KEY`로 쓰고 있는지만 확인하고 4단계의 alias 등록과 7단계 확인으로 간다.
  - 새로 설치: 사용자가 기존 컨테이너를 직접 정리한 뒤 진행한다(컨테이너 이름 `cli-proxy-api`와 포트 8317이 겹친다).

### 2단계: CLIProxyAPI 받기

`services/CLIProxyAPI`가 없을 때만 받는다. 이 경로는 `.gitignore`에 등록되어 있어 claude-proxy 저장소에 커밋되지 않는다.

```bash
git clone https://github.com/router-for-me/CLIProxyAPI.git services/CLIProxyAPI
```

### 3단계: CLIProxyAPI 설정 파일 만들기

```bash
cd services/CLIProxyAPI
[ -f config.yaml ] || cp config.example.yaml config.yaml
[ -f .env ] || cp .env.example .env    # 모든 줄이 주석이다. compose include가 이 파일을 요구한다.
```

`config.yaml`의 `api-keys`를 무작위 키 하나로 바꾼다. 키는 출력하지 않고 파일에만 쓴다.

```bash
NEW_KEY="$(openssl rand -hex 32)" python3 - <<'EOF'
import os, re
path = "config.yaml"
text = open(path).read()
block = 'api-keys:\n  - "%s"\n' % os.environ["NEW_KEY"]
text, count = re.subn(r'(?m)^api-keys:\n(?:[ \t]+-.*\n)+', block, text, count=1)
if count != 1:
    raise SystemExit("api-keys block not found")
open(path, "w").write(text)
print("api-keys updated")
EOF
```

`config.yaml`에 이미 사용자가 정한 `api-keys`가 있고 `CLIPROXY_KEY`가 그중 하나와 같다면 이 교체를 건너뛴다.

선택: `/switch-backend gpt`로 전역 전환했을 때 Claude 모델 이름을 GPT 모델로 바꿔 보내려면 `config.yaml` 끝에 다음 블록을 추가한다(이미 `oauth-model-alias:`가 있으면 `codex:` 항목만 합친다). `/model`에서 GPT 모델을 직접 고르는 방식에는 필요 없다.

```yaml
oauth-model-alias:
  codex:
    - name: "gpt-6-astra"
      alias: "claude-opus-5-5"
      fork: true
    - name: "gpt-6-astra"
      alias: "claude-fable-5-1"
      fork: true
    - name: "gpt-5.5"
      alias: "claude-sonnet-5"
      fork: true
    - name: "gpt-5.5"
      alias: "claude-haiku-4-5-20251001"
      fork: true
```

### 4단계: 셸 환경 등록

에이전트의 명령은 서로 셸 변수와 함수를 공유하지 않으므로, 키가 필요할 때마다 `config.yaml`에서 읽는다. 아래 함수는 `api-keys`의 첫 번째 값을 출력 없이 읽는다. 키를 쓰는 명령마다 이 함수 정의를 앞에 함께 붙여 실행한다.

```bash
read_cliproxy_key() {
  python3 -c 'import re; t=open("services/CLIProxyAPI/config.yaml").read(); print(re.search(r"(?m)^api-keys:\n[ \t]+-[ \t]*\"?([^\"\n]+)", t).group(1))'
}
```

`~/.zshrc`를 백업하고, 없는 항목만 추가한다. `REPO`는 저장소의 절대 경로로 바꾼다.

```bash
cp -p ~/.zshrc ~/.zshrc.bak-$(date +%Y%m%d-%H%M%S)
grep -q '^export CLIPROXY_KEY=' ~/.zshrc || printf '\nexport CLIPROXY_KEY=%s\n' "$(read_cliproxy_key)" >> ~/.zshrc
grep -q "alias claude-proxy=" ~/.zshrc || printf "alias claude-proxy='%s/bin/claude-proxy'\n" "$REPO" >> ~/.zshrc
```

- `~/.zshrc`에 `CLIPROXY_KEY`가 이미 있으면 그 값이 `config.yaml`의 `api-keys` 중 하나와 같은지 출력 없이 비교하고, 다르면 사용자에게 어느 쪽을 쓸지 묻는다.
- 기존 `alias claude-proxy=`가 `ANTHROPIC_BASE_URL=...` 형태(실행기를 거치지 않는 예전 방식)이면 사용자에게 알리고, 승인받은 뒤 실행기 경로로 바꾼다.
- 라우터를 컨테이너 대신 로컬 node 프로세스로 띄우려면 alias 앞에 `CLAUDE_PROXY_MODE=local`을 붙인다.

### 5단계: 컨테이너 시작

저장소 루트에서 CLIProxyAPI 컨테이너만 시작한다. 라우터는 `claude-proxy` 실행기가 필요할 때 띄운다.

```bash
cd "$REPO"
docker compose up -d --pull missing --no-deps cli-proxy-api
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8317/
```

HTTP 응답 코드가 나오면 준비된 것이다. `000`이면 `docker logs --tail 30 cli-proxy-api`로 원인을 확인한다.

### 6단계: Codex 로그인 (사용자 작업)

로그인은 브라우저가 필요하므로 에이전트가 대신할 수 없다. 사용자에게 다음 명령을 Claude Code 입력창에서 `!`를 앞에 붙여 실행하고, 출력된 URL을 브라우저에서 열어 ChatGPT 계정으로 로그인해 달라고 요청한다.

```bash
! docker exec -it cli-proxy-api ./CLIProxyAPI -codex-login -no-browser
```

- 로그인 후 브라우저가 `localhost:1455`로 돌아오면 컨테이너가 인증 정보를 저장한다. 1455 포트는 `compose/cli-proxy-api.override.yml`이 `127.0.0.1`로 게시한다.
- 콜백이 실패하면 기기 코드 방식을 쓴다: `! docker exec -it cli-proxy-api ./CLIProxyAPI -codex-device-login`

### 7단계: 확인

키를 출력하지 않도록 명령 안에서만 변수를 쓴다. 에이전트의 셸에는 `CLIPROXY_KEY`가 없을 수 있으므로 4단계의 `read_cliproxy_key`로 읽어 넣는다(1단계에서 기존 컨테이너를 재사용하기로 했다면 사용자가 쓰던 `CLIPROXY_KEY`를 쓴다).

```bash
export CLIPROXY_KEY="$(read_cliproxy_key)"
curl -s http://127.0.0.1:8317/v1/models -H "x-api-key: $CLIPROXY_KEY" | python3 -c 'import sys,json; print([m["id"] for m in json.load(sys.stdin)["data"] if m["id"].startswith("gpt-")])'
CLAUDE_BIN=/usr/bin/true bin/claude-proxy
curl -s http://127.0.0.1:3456/admin/status | python3 -c 'import sys,json; print([(b["id"], b["available"]) for b in json.load(sys.stdin)["data"]["availableBackends"]])'
python3 -c 'import json; print([o["model"] for o in json.load(open(".claude-proxy/model-picker.json"))["modelPicker"]["options"]])'
```

다음을 모두 만족하면 성공이다.

- CLIProxyAPI 모델 목록에 `gpt-`로 시작하는 모델이 있다. 비어 있으면 6단계 로그인이 끝나지 않은 것이다.
- `/admin/status`에서 `gpt`가 `True`(사용 가능)다. `False`면 실행기를 띄운 셸에 `CLIPROXY_KEY`가 없는 것이다.
- `.claude-proxy/model-picker.json`에 GPT 모델이 있다.

`config.json`의 `gpt.models`에 없는 GPT 모델이 CLIProxyAPI 목록에 있으면, 사용자에게 알리고 원하면 `models`에 추가한 뒤 라우터를 다시 시작한다(로컬 모드는 `kill $(cat proxy.pid)`, 컨테이너 모드는 `docker compose up -d --no-deps --force-recreate router`).

### 8단계: 결과 보고

사용자에게 다음을 알린다.

- 바뀐 파일과 백업 위치(`~/.zshrc.bak-...`). 키 값은 알리지 않는다.
- 새 터미널을 열거나 `source ~/.zshrc`를 실행한 뒤 `claude-proxy`로 시작한다.
- `/model`에서 GPT 모델을 고를 때 Enter가 아니라 `s`(이 세션만)를 누른다. Enter는 사용자 기본 모델로 저장되어 일반 `claude` 실행이 실패한다.
