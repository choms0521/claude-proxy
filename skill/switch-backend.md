---
name: switch-backend
description: Claude Code Proxy Router의 백엔드를 전환하거나 상태를 확인한다.
argument-hint: "[status|claude|minimax]"
---

Claude Code Proxy Router의 백엔드를 전환하거나 상태를 확인한다. $ARGUMENTS: [status|claude|minimax]

## 동작

1. 먼저 항상 `curl -s http://localhost:3456/admin/status`를 실행하여 현재 상태를 가져온다.
2. 결과를 아래 형식으로 보여준다:

```
현재 백엔드: [활성 백엔드 이름]

가용 백엔드:
  [활성] claude - Claude API
  [비활성] minimax - MiniMax API
```

3. 인자가 없거나 `status`이면 위 상태만 표시하고 끝.
4. 인자가 백엔드 ID이면: `curl -s -X POST http://localhost:3456/admin/switch -H "Content-Type: application/json" -d '{"backend":"$ARGUMENTS"}'` 실행 후 전환 결과를 보고.
5. Proxy가 꺼져있으면 (연결 실패 시) "Proxy가 실행 중이 아닙니다. `npm start`로 먼저 시작해주세요." 안내.

**중요**: 전환은 다음 턴부터 적용된다. 현재 턴의 응답은 기존 모델이 처리한다.
