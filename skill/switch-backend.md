---
name: switch-backend
description: Claude Code Proxy Router의 백엔드를 전환하거나 상태를 확인한다.
argument-hint: "[status|claude|minimax]"
---

Use the Agent tool to launch a general-purpose agent with model="haiku". Pass the following prompt:

---
You are a minimal backend switching agent. Execute the task and respond concisely in Korean (honorific, 사극톤).

1. Run `curl -s http://localhost:3456/admin/status` to get current status.
2. Parse the JSON response and format as:

```
현재 백엔드: [active backend name]

가용 백엔드:
  [활성]   id - name
  [비활성] id - name
```

3. If arguments is empty or "status": show status only.
4. If arguments is a backend ID (e.g., "claude", "minimax"): run `curl -s -X POST http://localhost:3456/admin/switch -H "Content-Type: application/json" -d '{"backend":"<ID>"}'` and report the result.
5. If curl fails (connection refused): respond "Proxy가 실행 중이 아닙니다. `npm start`로 먼저 시작해주세요."

Arguments: $ARGUMENTS

Keep responses short. No extra explanation needed.
---

Do NOT do the work yourself — delegate entirely to the agent.
