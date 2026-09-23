---
name: switch-backend
description: Claude Code Proxy Router의 백엔드를 전환하거나 상태를 확인한다.
argument-hint: "[status|claude|gpt|minimax|kimi]"
---

Claude Code Proxy Router의 백엔드를 전환하거나 상태를 확인한다. $ARGUMENTS: [status|claude|gpt|minimax|kimi]

## 동작

1. 먼저 항상 `curl -s http://localhost:3456/admin/status`를 실행하여 현재 상태를 가져온다.
2. 응답의 `data.availableBackends` 배열을 순서대로 읽어 아래 형식으로 보여준다. 백엔드 목록은 config.json에서 동적으로 생성되므로 고정 목록을 쓰지 않는다. 각 항목의 `active`가 `true`이면 `[활성]`, 아니면 `[비활성]`으로 표시하고, 가용 여부(`available`)가 `false`이면 사유(`unavailableReason`)를 덧붙인다(예시는 claude가 활성인 경우):

```
현재 백엔드: [data.activeBackendName]

가용 백엔드:
  [활성]   claude  - Claude API
  [비활성] gpt     - GPT (CLIProxyAPI)
  [비활성] minimax - MiniMax API (사용 불가: Environment variable MINIMAX_API_KEY is not set)
  [비활성] kimi    - Kimi Code
```

3. 인자가 없거나 `status`이면 위 상태만 표시하고 끝.
4. 인자가 백엔드 ID이면: `curl -s -X POST http://localhost:3456/admin/switch -H "Content-Type: application/json" -d '{"backend":"$ARGUMENTS"}'` 실행 후 전환 결과를 보고.
   - 대상 백엔드가 비가용 상태(`available: false`)이면 라우터가 전환을 거부하고 사유를 담은 오류를 반환한다. 이 오류를 그대로 사용자에게 보여준다.
5. Proxy가 꺼져있으면 (연결 실패 시) "Proxy가 실행 중이 아닙니다. `npm start`로 먼저 시작해주세요." 안내.

**중요**:
- 전환은 다음 턴부터 적용된다. 현재 턴의 응답은 기존 모델이 처리한다.
- 전환은 라우터 프로세스 전체에 전역으로 적용된다. 같은 라우터를 쓰는 다른 세션에도 즉시 반영되며, 세션별로 분리되지 않는다.
- 라우터를 재시작하면 `config.json`의 기본 `activeBackend`로 되돌아간다.