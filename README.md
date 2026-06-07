# MAK 발권 에이전트

터미널과 기차역의 무인발권기를 **말로 부탁하는 응대형 인터페이스**로 바꾸기 위한 음성 기반 키오스크 UI 프로토타입입니다.
노인과 디지털 약자가 복잡한 절차를 직접 따라 누르는 대신, 매표원 캐릭터에게 목적지와 시간을 말하면 AI가 의도를 파악하고 실제 교통편을 조회해 표 선택과 결제 안내까지 도와주는 것을 목표로 합니다.

현재 버전은 기존 정적 UI 위에 다음 API 경로를 붙인 MVP 전환 버전입니다.

- OpenAI Realtime STT: 사용자 음성 → 실시간 텍스트 자막
- OpenAI LLM: 발권 의도 추출, 다음 UI action 결정, 쉬운 안내 문장 생성
- 국토교통부 TAGO TrainInfo: 실제 열차 시간표/운임 조회
- OpenAI TTS: 안내 문장 음성 출력

> MVP 범위는 실제 결제/발권 완료가 아니라 **열차 조회 → 후보 선택 → 결제 안내 전 단계**입니다.

## 목표 작동 흐름

1. 화면이 켜지면 매표원 캐릭터가 큰 글씨로 먼저 인사합니다.
2. 사용자가 말합니다. 예: `부산, 오늘 오후 3시쯤`
3. 서버가 OpenAI STT로 음성을 텍스트로 변환합니다.
4. 서버가 OpenAI LLM으로 텍스트에서 발권 의도를 추출합니다.
5. 정보가 부족하면 캐릭터가 한 번에 하나씩 되묻습니다.
6. 사용자가 요약을 확인하면 서버가 TAGO API로 실제 열차를 조회합니다.
7. 화면은 실제 API 응답 기반 후보를 보여줍니다.
8. 사용자가 “빠른 거”, “싼 거” 또는 카드 터치로 선택합니다.
9. 캐릭터가 결제 단계로 안내합니다.

## API 역할

| API | 역할 | 비유 |
| --- | --- | --- |
| OpenAI Realtime STT | 노인의 음성을 실시간 텍스트로 변환 | 귀 |
| OpenAI LLM | 발권 의도 파악, 부족한 정보 질문, 다음 action 결정 | 뇌 |
| TAGO TrainInfo | 실제 열차 시간, 운임, 열차번호 조회 | 손 |
| OpenAI TTS | 안내 문장을 음성으로 출력 | 목소리 |

LLM은 대화와 의도 파악을 담당하고, 실제 운행 정보와 운임은 TAGO API 응답을 기준으로 안내합니다.

## 파일 구조

```text
.
├── index.html              # 키오스크 화면 마크업
├── kiosk.css               # 디자인 시스템 / 레이아웃
├── src/
│   ├── main.ts             # 프론트 상태머신, 녹음, API 호출, 렌더링
│   └── types.ts            # 공유 타입
├── server/
│   ├── app.ts              # Express API 서버
│   ├── routes/             # realtime/stt/dialog/trains/tts route
│   ├── services/           # LLM, audio, TAGO search service
│   ├── integrations/       # OpenAI/TAGO client
│   └── schemas/            # Structured Outputs JSON schema
├── assets/
│   ├── mak-character-bust.png
│   └── mak-character-searching.png
└── .env.example
```

## 환경 변수

실제 키는 `.env`에만 넣고 git에 올리지 않습니다.

```dotenv
OPENAI_API_KEY=
OPENAI_LLM_MODEL=gpt-5.4-mini
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=coral
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe

DATA_GO_KR_SERVICE_KEY=
DATA_GO_KR_SERVICE_KEY_TYPE=encoding
TAGO_BASE_URL=https://apis.data.go.kr/1613000/TrainInfo

KIOSK_DEFAULT_DEPARTURE_STATION=서울
KIOSK_TIMEZONE=Asia/Seoul
```

## 실행 방법

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API server: http://localhost:8787
- Health check: http://localhost:5173/api/health

브라우저 마이크 권한이 필요합니다. 기본은 WebRTC Realtime STT이며, 실시간 연결에 실패하면 기존 짧은 녹음 파일 STT로 자동 fallback합니다.

## 검증 명령

```bash
npm run check
npm run build
```

## 데모 컨트롤

하단 데모 컨트롤은 기본 운영 화면에서 숨겨집니다. 기존 프로토타입처럼 수동으로 화면을 넘기려면 아래 URL을 사용합니다.

```text
http://localhost:5173/?demo=1
```

## 현재 제한 사항

- 실제 결제 승인, 좌석 점유, 승차권 발권은 구현 범위 밖입니다.
- TAGO API는 공개 열차 시간표/운임 조회용입니다. 좌석 가능 여부와 예약 확정은 별도 제휴/내부 API가 필요합니다.
- 현재 Realtime STT는 서버 VAD로 발화 종료를 감지하고, 장시간 발화는 약 6.5초 후 안전 종료합니다.
- TTS API 호출 실패 시 브라우저 기본 `speechSynthesis`로 fallback합니다.
