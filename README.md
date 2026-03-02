# Korean Spell Check Tool

OpenAI API 기반 한국어 맞춤법/띄어쓰기 교정 웹 도구입니다.

## Run

```bash
npm start
```

필수 환경변수:

```bash
OPENAI_API_KEY=sk-...
```

선택 환경변수:

```bash
OPENAI_MODEL=gpt-4.1-mini
SPELL_CACHE_TTL_MS=600000
```

## A/B Evaluation Design

현재 방식과 OpenAI 모델 후보를 비교할 때 아래 지표를 함께 봅니다.

- `exactMatchRate`: 모델 출력이 골든 정답과 완전히 같은 비율
- `improveRate`: 원문 대비 정답과의 거리(편집거리)가 줄어든 비율
- `regressRate`: 원문 대비 더 나빠진 비율
- `overcorrectionRate`: 원문이 이미 정답인데 불필요하게 바꾼 비율
- `fixRateOnDirty`: 실제 오류 문장에서 정답으로 정확히 고친 비율
- `p50/p95 latency`: 응답 지연
- `tokens + estimatedCostUsd`: 모델별 추정 비용

평가용 골든셋 예시는 `eval-data/spell_eval_sample.jsonl` 입니다.

## Run A/B Eval

```bash
npm run eval:spell
```

기본 비교 모델:

- `gpt-4.1-mini`
- `gpt-4.1-nano`

환경변수로 변경 가능:

```bash
SPELL_EVAL_MODELS=gpt-4.1-mini,gpt-4.1
SPELL_EVAL_DATASET=eval-data/spell_eval_sample.jsonl
SPELL_EVAL_MAX_SAMPLES=200
SPELL_EVAL_TEMPERATURE=0.1
npm run eval:spell
```

결과 JSON은 `eval-data/spell_eval_result_*.json` 으로 저장됩니다.

## Recommended Model Strategy

- 기본 운영: `gpt-4.1-mini` (품질/비용 균형)
- 초저비용 대량 처리: `gpt-4.1-nano` (오교정률 반드시 확인)
- 고정밀 배치 교정: `gpt-4.1` (비용 허용 시)

권장 롤아웃:

1. `mini`를 기본값으로 운영
2. `nano`를 A/B shadow 테스트로 붙여 비용 절감 폭 확인
3. 민감 문서(대외 공지/법무/이력서 최종본)는 `4.1` 또는 휴먼 검수 경로 적용

## AdSense Readiness Checklist

애드센스 심사 전 아래 항목을 반드시 채워 주세요.

1. `contact.html`의 `admin@example.com`을 실제 운영 이메일로 교체
2. `robots.txt`와 `sitemap.xml`의 `https://example.com`을 실제 도메인으로 교체
3. `ads.txt`의 `pub-XXXXXXXXXXXXXXXX`를 실제 AdSense 퍼블리셔 ID로 교체
4. 배포 후 Search Console에서 사이트맵 제출
5. 404/500 페이지 노출 없이 모든 링크 정상 동작 확인

정책/안내 페이지:

- `/about.html`
- `/privacy.html`
- `/terms.html`
- `/contact.html`
