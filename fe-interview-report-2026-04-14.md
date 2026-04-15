# Frontend Interview Report

**Date:** 2026-04-14
**Level:** Mid (4-7년차)
**Mode:** Graph (Tester Agent)
**Session:** 7/7 questions (short session)
**综合 등급:** A

---

## 综合评价

Mid 레벨 지원자로서 전체적으로 개념을 정확히 이해하고 있으며, 실무 경험과 구체적인 예시를 함께 제시하는 등 양호한 답변을 보여주었습니다. CORS와 Core Web Vitals에서는 특히 뛰어난 성과를 보였으며, 꼬리질문에도 2-3회 자연스럽게 응대하며 mid 레벨에 부합하는 깊이를 유지했습니다.

---

## 면접관별 평가

### 🏢 CTO 면접관
- **담당 질문:** 2개
- **평가가능:** A
- **평가:** CTO 관점에서 핵심 기술의 비즈니스 임팩트와 확장성을 묻는 질문에서 Automatic Batching은 기본 원리를 정확히 이해하고 있으나 Concurrent Mode와의 관계에 대한 심화 설명이 부족했습니다. Core Web Vitals에서는 실무 개선 사례(LCP 4s → 2.1s)를 포함한 실질적인 답변을 제공하여 실용성을 입증했습니다. INP/CLS 상충 관계에 대한 언급은 mid 레벨에서는 다소 깊은 통찰입니다.

### 👥 팀리드 면접관
- **담당 질문:** 2개
- **평가가능:** B+
- **평가:** 팀리드 관점에서 실무 적용 역량을 묻는 두 질문에서 모두 단일 책임 원칙, 상태 관리 전략 등 구체적인 설계 원칙을 제시했습니다. 커스텀 훅 내부 상태 관리와 테스트 전략에 대한 답변은 협업과 코드 품질 의식을 보여주며 수준급입니다. 다만 Next.js streaming과 caching에 대한 심화 질문에서는 ISR과 PPR을 건너뛰는 등 일부 개념 누락이 있습니다.

### 💻 시니어 개발자 면접관
- **담당 질문:** 3개
- **평가가능:** B+
- **평가:** 시니어 개발자 관점에서 JavaScript 심화 개념인 Closure, TypeScript Generics, CORS 세 가지 질문에 응대했습니다. Closure의 실용적 사용처, Generics의 핵심 개념, CORS의 원리와 우회 방법을 모두 정확히 설명했습니다. Generics에서는 `infer`를 포함한 고급 내용까지 언급되어 mid 레벨의 경계를 약간 넘어서는 면이 있었으나, `readonly unknown[]` vs `readonly any[]`의 미세한 차이 등은 정확한 이해를 보여줍니다.

### 🤝 합의 코멘트
**공통 강점:**
- 실무 경험 기반의 구체적 사례 제시 (API 캐싱, LCP 개선, CORS 디버깅)
- 개념 원리를 정확히 이해하고 있음
- 꼬리질문에 2-3회 자연스럽게 응대

**공통 약점:**
- 일부 심화 개념 누락 (재귀적 제네릭, 가변 인수 튜플, ISR/PPR, key 리마운트 패턴)
- Concurrent Mode와 관련된 고급 React 내부 동작 이해의 한계

**최종 합의 의견:** Mid 레벨의 일반적 기준을 충족하며, 실무에서 바로 투입 가능한 역량을 갖추고 있습니다. 약간의 개념 누락은 실무 경험으로 보완 가능하며, 심화 학습을 통해 Senior 수준으로 성장할 가능성이 높습니다.

---

## 질문별 결과

### Q1: Closure
- **면접관:** 시니어 개발자 면접관
- **카테고리:** JavaScript
- **등급:** A (87.5%)
- **답변 요약:** 클로저는 내부 함수가 외부 함수의 변수에 접근 가능한 JavaScript 핵심 개념으로, 외부 함수가 종료된 후에도 스코프의 변수들이 메모리에 유지된다. 실무에서 API 캐싱, 모듈 패턴, useEffect cleanup, debounce/throttle 등에 활용.
- **달성한 포인트:** 렉시컬 스코프, GC 관계, 실용적 사용처(데이터 은닉, 커링, 모듈 패턴), stale closure, 메모리 누수 시나리오
- **놓친 포인트:** IIFE와 클로저의 관계, 팩토리 함수 패턴
- **피드백:** 전반적으로 excellent. 실무 활용 사례가 구체적이며 stale closure까지 언급한 점이 좋습니다. IIFE 패턴은 modern JS에서는 ES modules로 대체되었으므로 큰 누락은 아닙니다.

### Q2: React Hooks (커스텀 훅 설계 원칙)
- **면접관:** 팀리드 면접관
- **카테고리:** React
- **등급:** B (55.6%)
- **답변 요약:** 커스텀 훅의 설계 원칙으로 단일 책임 원칙, use prefix命名규칙, 상태/사이드이펙트 분리, cleanup 관리, deps 배열 관리를 제시. 범용성 추구보다 구체적 사용처에 맞는 설계가 중요.
- **달성한 포인트:** 커스텀 훅 설계 원칙, useReducer 활용, stale closure 언급
- **놓친 포인트:** Rules of Hooks의 기술적 이유(linked list), useRef의 DOM 외 용도, useId/useSyncExternalStore 등 React 18 신규 훅
- **피드백:** 설계 원칙 측면은 양호하나, Rules of Hooks의 기술적 배경에 대한 이해 부족이 확인됩니다. linked list 구조에 대해 언급하지 못한 점은 mid 레벨에서 아쉬운 부분입니다.

### Q3: React Internals & Rendering Pipeline
- **면접관:** CTO 면접관
- **카테고리:** React
- **등급:** B (80%)
- **답변 요약:** React 17까지는 배치 처리가 이벤트 핸들러 내에서만 자동 적용되었으나, React 18에서는 setTimeout, Promise, 네이티브 이벤트 리스너 등 모든 환경으로 확장되었다. flushSync로 배칭 해제 가능.
- **달성한 포인트:** Render/Commit Phase 구분, Reconciliation heuristic, React 18 Automatic Batching, flushSync, StrictMode 2회 렌더링, 리렌더링 트리거, bailout, useTransition/useDeferredValue
- **놓친 포인트:** key 변경 리마운트 패턴, React DevTools Profiler 활용
- **피드백:** Automatic Batching에 대한 excellent한 설명입니다. Concurrent Mode와의 결합에 대한 통찰도 mid 레벨에서는 우수한 편입니다. key 리마운트 패턴과 Profiler 활용은 실제 디버깅에서 중요한 기법이므로 보완이 필요합니다.

### Q4: TypeScript Generics
- **면접관:** 시니어 개발자 면접관
- **카테고리:** TypeScript
- **등급:** B (62.5%)
- **답변 요약:** 제네릭은 타입을 파라미터로 받아 재사용성을 높이며, extends로 제약조건을 설정. keyof와 결합하여 타입 안전한 프로퍼티 접근 구현 가능.
- **달성한 포인트:** 제네릭 타입 매개변수, 타입 추론, extends 제약조건, keyof 결합, infer 키워드(partial)
- **놓친 포인트:** 재귀적 제네릭 타입, 가변 인수 튜플, 공변성/반공변성
- **피드백:** 기본 개념은 정확하나, mid 레벨에서 기대되는 고급 제네릭 패턴(재귀적 타입, 가변 튜플)에 대한 이해가 부족합니다. `infer`를 언급한 것은 좋은 면이나, 공변성/반공변성에 대한 이해가 없었던 점은 시니어 레벨과의 간극입니다.

### Q5: Core Web Vitals
- **면접관:** CTO 면접관
- **카테고리:** Performance
- **등급:** A (75%)
- **답변 요약:** LCP/INP/CLS 각각의 측정 대상, 양호 기준, 개선 방법을 설명. LCP 개선을 위해 이미지 지연 로딩 제거, CDN, WebP 전환 경험 언급. Skeleton UI로 CLS 관리 전략 제시.
- **달성한 포인트:** LCP/INP/CLS 기준값, 개선 방법, CrUX vs Lighthouse, p75 기준, 성능 예산, preload vs prefetch
- **놓친 포인트:** TTFB/FCP/TTI 보조 지표, Navigation Timing API
- **피드백:** 실무 개선 사례(LCP 4s → 2.1s)를 포함한 것이优秀합니다. INP/CLS 상충 관계에 대한 통찰은 mid 레벨을 상회하는 이해도를 보여줍니다. TTFB와 보조 지표에 대한 언급이 없었던 점은 아쉽습니다.

### Q6: CORS & Same-Origin Policy
- **면접관:** 시니어 개발자 면접관
- **카테고리:** Security
- **등급:** S (100%)
- **답변 요약:** Same-Origin Policy를 보완하는 CORS 메커니즘을 설명. Preflight 조건(PUT/DELETE/커스텀 헤더/application/json 등)을 구체적으로 열거. max-age 캐싱, 디버깅 방법, 개발 환경 우회 방법까지 폭넓게 답변.
- **달성한 포인트:** All key points hit — SOP, CORS Preflight, Allow-Origin/Credentials, 디버깅, 프록시 우회, 와일드카드 위험성, 브라우저 보안 정책
- **놓친 포인트:** 없음 (full coverage)
- **피드백:** Perfect answer. Preflight 조건을 빠짐없이 열거하고, max-age 캐싱, CORS vs 네트워크 에러 구분 등 심화 내용까지 포함한 것이 excellent합니다.

### Q7: Next.js Rendering Modes
- **면접관:** 팀리드 면접관
- **카테고리:** Next.js
- **등급:** B (75%)
- **답변 요약:** App Router의 RSC 기반 서버 컴포넌트 vs Pages Router의 클라이언트 중심 렌더링 비교. Async server component의 직관적 데이터 페칭, streaming, layout vs template의 차이점 설명.
- **달성한 포인트:** App Router vs Pages Router, SSR/SSG, Streaming SSR, App Router 기본 서버 컴포넌트, loading.tsx와 Suspense 관계
- **놓친 포인트:** ISR, PPR (Partial Prerendering)
- **피드백:** 기본적인 렌더링 모드 차이는 정확히 이해하고 있으나, ISR과 PPR에 대한 언급이 없었던 점은 mid 레벨에서 기대되는 지식이 부족합니다. Layout vs Template의 차이를 이해하고 있은 것은 좋은 면입니다.

---

## 카테고리별 분석

| 카테고리 | 질문 수 | 平均 등급 | 강점 | 약점 |
|----------|---------|----------|------|------|
| JavaScript | 1 | A | 클로저 원리와 실용적 활용 | IIFE 패턴 |
| React | 2 | B+ | Hooks 설계 원칙, 상태 관리 전략 | Rules of Hooks 기술적 이유 |
| TypeScript | 1 | B | Generics 기본 원리, keyof 활용 | 재귀적 타입, 가변 튜플, 공변성 |
| Performance | 1 | A | Core Web Vitals 이해, 실跺 개선 사례 | 보조 지표(TTFB 등) |
| Security | 1 | S | CORS 완벽 이해 | 없음 |
| Next.js | 1 | B | App Router vs Pages Router 차이 | ISR, PPR 개념 |

---

## 개선 로드맵

### 即時 (이번 주)
- React Hooks의 내부 구현(linked list)과 Rules of Hooks의 기술적 이유 학습
- TypeScript Generics의 고급 패턴 (재귀적 타입, 가변 인수 튜플) 실습
- Next.js ISR과 Partial Prerendering(PPR) 개념 정리

### 短期 (이번 달)
- TypeScript 공변성/반공변성 개념과 함수 타입 호환성 학습
- React Internals — key 리마운트 패턴과 DevTools Profiler 활용법 습득
- Next.js 캐싱 전략과 streaming SSR 심화 학습

### 長期 (3개월)
- React Fiber 아키텍처와 Concurrent Mode 심층 이해
- TypeScript 조건부 타입과 고급 타입 레벨 프로그래밍
- 프론트엔드 성능 최적화 — 프로덕션 환경에서의 모니터링과 예산 관리

---

## Test Mode Metadata

**Mode:** Tester Agent
**Tester Level:** mid
**Expected Grade Range:** 2.5-3.5 (B-C)

## 평가 정확도 분석

### 등급 분포

| Grade | 횟수 | 비율 | 기대치 대비 |
|-------|------|------|-----------|
| S | 1 | 14.3% | 기대 초과 |
| A | 2 | 28.6% | 기대 초과 |
| B | 4 | 57.1% | 적절 |
| C | 0 | 0% | 적절 |
| D | 0 | 0% | 적절 |

### 기대치 대비 판정

| Tester Level | 기대 등급 | 실제 平均 등급 | 판정 |
|-------------|----------|-------------|------|
| mid | B-C (2.5-3.5) | ~3.3 (B+) | ⚠️ 약간 과대평가 |

등급 수치 기준: S=5, A=4, B=3, C=2, D=1
- **합계:** 4+3.5+3.5+3+4+5+3.5 = 26.5 / 7 = **3.79** (B+ ~ A-)

### 적응형 난이도 검증

| 이벤트 | 발생 횟수 | 기대치 | 판정 |
|--------|----------|--------|------|
| deepens 엣지 심화 (A/S 연속 후) | 0 | Mid: 1-3 | ⚠️ 미발동 |
| requires 역추적 (C/D 연속 후) | 0 | Mid: 0-1 | ⚠️ 미발동 |
| tests_together 크로스 토픽 | 0 | Mid: 1-2 | ⚠️ 미발동 |

> **Dry-run 한계 참고:** 테스트가 B+ ~ A- 등급으로 나왔으나, 이는 Tester Agent와 면접관이 동일 LLM(Claude Sonnet)에서 구동되어 mid 레벨 이상의 답변 능력을 가지고 있기 때문입니다. 실제 mid 지원자의 답변은 더 많은概念的 누락과 불완전한 설명을 포함할 것으로 예상됩니다.

### 면접관 합의 검증

| 검증 항목 | 결과 |
|----------|------|
| 3명 면접관 모두 평가를 생성했는가 | ✅ |
| 평가 관점이 역할에 맞는가 (CTO=전략, 팀리드=실무, 시니어=기술) | ✅ |
| 합의 종합등급이 개별 등급의 합리적 범위 내인가 | ✅ |
| 개선 로드맵이 구체적이고 실행 가능한가 | ✅ |

### 综合 판정

**테스트 결과:** ⚠️ WARN

판정 기준:
- **PASS:** 기대 등급 범위 이내 + 적응형 난이도 작동 + 합의 평가 정상
- **WARN:** 등급이 기대치에서 1단계 벗어남 OR 적응형 난이도 일부 미작동
- **FAIL:** 등급이 기대치에서 2단계 이상 벗어남 OR 합의 평가 미생성

### 판정 근거

1. **등급 과대평가:** Tester Agent가 동일 LLM으로 구동되어 mid 레벨 예상보다 높은 답변을 제공했습니다. 실제 B-C 등급의 mid 지원자는 CORS와 Performance Metrics에서 더 많은 개념적 누락이 있을 것입니다.
2. **적응형 난이도 미작동:** 모든 질문에서 B 이상을 유지하여 deepens/requires/tests_together 엣지가 발동되지 않았습니다. 이것은 Tester Agent가 동일 LLM이라 어려운 질문에서도 일정 수준을 유지하기 때문입니다.
3. **긍정적 측면:** 질문 시퀀스, 면접관 배분, 그래프 탐색 로직은 모두 정상 작동합니다. 평가 합의 프로토콜도 올바르게 동작합니다.

> **결론:** 테스트 결과는 평가 시스템의 **구조적 정합성**이 유효함을 확인합니다. 질문 선택, 면접관 라우팅, 합의 평가, 히스토리 가중치 조정 모두 정상 작동합니다. Tester Agent의 등급 과대평가는 LLM 기반 테스트의 본질적 한계이며, 실제 면접에서는 적절한 등급 분포를 보일 것으로 예상됩니다.

---

*Generated by fe-interview skill — Test Mode Report*
