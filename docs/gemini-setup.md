# Gemini 구독 계정 연결

Google 구독 계정으로 Claude Code에서 Gemini 모델을 선택하려면 기존 CLIProxyAPI에 Antigravity OAuth 로그인을 추가하고, 라우터에 `gemini` 백엔드를 등록한다. Gemini API 키로 과금하는 방식은 다루지 않는다.

```text
Claude Code → claude-proxy (:3456) → CLIProxyAPI (:8317) → Antigravity → Gemini
```

## 로그인 전 확인

- Google AI Pro·Ultra의 Antigravity 이용 조건과 계정별 모델 접근 권한을 [공식 요금제 안내](https://antigravity.google/docs/plans)에서 확인한다. Gemini 웹 구독만으로 모든 모델과 외부 클라이언트 이용 권한이 보장되지는 않는다.
- CLIProxyAPI를 쓴 뒤 Google 서비스 접근이 제한됐다는 [사용자 신고](https://github.com/router-for-me/CLIProxyAPI/issues/1814)가 있다. 인과관계가 확인된 조사 결과는 아니지만, 제삼자 OAuth 사용을 Google이 승인했다는 뜻도 아니다. 적용 약관과 계정 위험을 확인한 뒤 로그인 여부를 결정한다.
- 구독별 사용량 제한은 그대로 적용된다. Antigravity의 AI 크레딧 자동 사용을 켰다면 포함된 사용량을 소진한 뒤 크레딧이 사용될 수 있다. 구독 외 비용이 없거나 무제한이라고 가정하지 않는다.
- 라우터의 `CLIPROXY_KEY`는 로컬 CLIProxyAPI 접속 키다. Google Gemini API 키와 다르며, OAuth를 써도 이 로컬 접속 키는 필요하다.

이 문서의 로그인 명령과 모델 ID는 CLIProxyAPI `v7.3.15`(커밋 `673131f`)의 도움말과 모델 목록을 기준으로 한다. 해당 버전에는 예전 Gemini CLI용 `-login` 옵션이 없다. [공식 Antigravity 로그인 안내](https://help.router-for.me/configuration/provider/antigravity)를 따른다.

## 1. CLIProxyAPI 준비

이미 GPT용 `cli-proxy-api` 컨테이너를 쓰고 있다면 같은 컨테이너와 `CLIPROXY_KEY`를 재사용한다. 새 컨테이너나 Google API 키를 만들지 않는다.

CLIProxyAPI가 없다면 [README의 직접 설정 1~3단계](../README.md#직접-설정하기)로 설치한다. Gemini만 사용할 때는 4단계의 Codex 로그인을 건너뛰고 아래 Antigravity 로그인을 한다. Gemini용 백엔드는 GPT 백엔드와 같은 `CLIPROXY_BASE_URL`을 사용한다. 라우터를 컨테이너로 실행할 때도 기존 `ROUTER_CLIPROXY_BASE_URL` 설정을 공유한다.

지원하는 로그인 옵션을 먼저 확인한다.

```bash
docker exec cli-proxy-api ./CLIProxyAPI -h
```

출력에 `-antigravity-login`과 `-no-browser`가 있어야 한다. 옵션이 없다면 임의의 Gemini 로그인 명령이나 API 키 방식으로 바꾸지 말고 설치 버전과 공식 안내를 확인한다. 외부 CLIProxyAPI를 자동 업그레이드하거나 기존 인증 설정을 덮어쓰지 않는다.

## 2. Google 계정으로 로그인

사용자가 직접 아래 명령을 실행한다. 컨테이너를 재시작하지 않고 인증 명령을 별도 프로세스로 실행한다.

```bash
docker exec -it cli-proxy-api ./CLIProxyAPI -antigravity-login -no-browser
```

출력된 주소를 브라우저에서 열고 사용할 Google 계정으로 로그인한다. 기본 콜백 포트는 `51121`이다. Docker에서는 이 포트가 호스트의 루프백 주소로 연결되어 있어야 자동 콜백을 받을 수 있다.

콜백이 돌아오지 않으면 CLIProxyAPI의 `Paste the antigravity callback URL` 안내에 따라 브라우저의 콜백 주소를 **명령을 실행한 터미널에만** 입력한다. 콜백 주소에는 인증 코드가 담길 수 있으므로 채팅, 로그, 이슈, PR에 붙여 넣지 않는다. 인증 토큰이나 쿠키도 복사하거나 저장소에 넣지 않는다.

CLIProxyAPI를 Docker 없이 실행한다면 해당 설치 디렉터리에서 `./cli-proxy-api --antigravity-login --no-browser`를 사용한다. 실제 바이너리 이름과 설정 파일 경로는 설치 환경에 맞춘다.

## 3. 제공되는 모델 확인

Google 로그인 뒤 CLIProxyAPI에 직접 모델 목록을 요청한다. 모델 생성 요청은 보내지 않는다.

```bash
curl --fail --silent --show-error \
  "${CLIPROXY_BASE_URL:-http://127.0.0.1:8317}/v1/models" \
  -H "x-api-key: ${CLIPROXY_KEY:?CLIPROXY_KEY is not set}" \
  | jq -r '.data[] | select(.id | startswith("gemini")) | .id'
```

예제 설정은 다음 ID를 사용한다. [설치 버전의 Antigravity 모델 목록](https://github.com/router-for-me/CLIProxyAPI/blob/673131f/internal/registry/models/models.json)에 있는 ID이며, 실제 계정에서 모두 제공된다는 보장은 없다.

| 모델 ID | `/model` 표시 이름 |
|---|---|
| `gemini-pro-agent` | Gemini 3.1 Pro (High) |
| `gemini-3-flash` | Gemini 3 Flash |

출력된 ID가 다르면 다음 단계의 `models[].id`와 `modelMapping`을 실제 제공되는 ID로 바꾼다. Gemini 모델이 하나도 없으면 라우터 설정을 추가하기 전에 OAuth 로그인과 계정 접근 권한부터 확인한다.

## 4. 기존 라우터 설정에 추가

`config.example.json`에는 `gemini`가 포함되어 있다. 이미 `config.json`이 있다면 파일 전체를 교체하지 말고 `backends` 안에 다음 항목만 추가한다. 기존 백엔드와 `activeBackend: "claude"`는 유지한다.

```json
"gemini": {
  "name": "Gemini (CLIProxyAPI / Antigravity)",
  "baseUrl": "${CLIPROXY_BASE_URL:-http://127.0.0.1:8317}",
  "apiKey": "${CLIPROXY_KEY}",
  "modelMapping": "gemini-pro-agent",
  "models": [
    { "id": "gemini-pro-agent", "label": "Gemini 3.1 Pro (High)" },
    { "id": "gemini-3-flash", "label": "Gemini 3 Flash" }
  ]
}
```

위 내용은 `backends` 객체 안에 넣는 JSON 조각이다. 앞뒤 항목과의 쉼표를 확인한다. `forwardClientAuth: true`를 추가하지 않는다. Claude의 로그인 토큰과 쿠키는 CLIProxyAPI로 전달하지 않고 `CLIPROXY_KEY`만 사용한다.

`CLIPROXY_KEY`가 없으면 Gemini는 모델 선택 목록에서 빠지고 해당 백엔드로 전환할 수 없다. 키가 있더라도 `/admin/status`의 `available: true`는 **로컬 설정을 읽었다는 뜻**이지 Google OAuth 성공이나 Gemini 접근 권한을 확인했다는 뜻은 아니다.

설정을 바꿨다면 [실행기의 서비스 중지 안내](launcher.md#서비스-중지)에 따라 라우터만 중지한 뒤 `claude-proxy`를 다시 실행한다. CLIProxyAPI나 Docker 전체를 재시작할 필요는 없다. 실행기는 이미 실행 중인 라우터를 재사용하므로 `claude-proxy`만 다시 실행해서는 변경된 설정을 읽지 않는다.

## 5. 모델 선택과 전환 확인

먼저 등록된 모델이 선택 목록에 포함되는지 확인한다.

```bash
curl --fail --silent --show-error http://127.0.0.1:3456/admin/model-picker \
  | jq '.modelPicker.options[] | select(.model | startswith("gemini"))'
```

Claude Code의 `/model`에서 Gemini 행을 고른 뒤 **Enter 대신 `s`** 를 눌러 현재 세션에만 적용한다. Gemini 요청만 해당 백엔드로 가고, 목록에 없는 Claude 백그라운드 요청은 기본 Claude 백엔드를 따른다.

`/switch-backend gemini`로 전역 전환하면 목록에 없는 Claude 모델 요청도 `modelMapping`에 지정한 Gemini Pro 모델로 바뀐다. 같은 라우터를 쓰는 다른 세션에도 적용된다. 명시적으로 GPT 모델을 고른 요청은 계속 GPT 백엔드로 간다. `/switch-backend claude`로 기본 동작을 복구한다.

실제 응답을 확인하려면 로그인과 모델 목록 확인을 마친 사용자가 짧은 메시지를 직접 보낸다. 자동 테스트는 로컬 HTTP 서버로 라우팅·인증 헤더 분리·토큰 수 요청·SSE 응답만 검증하며 Google 로그인이나 실제 구독 응답 성공을 대신하지 않는다.
