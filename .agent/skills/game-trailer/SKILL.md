---
name: game-trailer
description: >
  Create game trailer and promotional videos from gameplay recordings.
  Records gameplay via browser canvas capture, analyzes highlights with AI (Gemini),
  and auto-edits clips for ASO/UA using FFmpeg.
  Triggers on "game trailer", "게임 트레일러", "ASO 영상", "UA 영상",
  "프로모 영상", "홍보 영상", "하이라이트 영상", "녹화", "record gameplay",
  "영상 만들어줘", "트레일러 만들어줘", "앱스토어 영상", "광고 영상"
---

# game-trailer — 게임 트레일러 & 프로모 영상 제작

게임플레이 녹화 → AI 하이라이트 분석 → 자동 컷편집. 스토어 프리뷰 + 광고 소재를 한 번에.

## 사전 요구

```bash
agent-browser --version   # 브라우저 제어 + 캔버스 녹화
codeb whoami              # AI 영상 분석 (Gemini)
ffmpeg -version           # 컷편집
```

FFmpeg 미설치 시:
```
Windows: winget install Gyan.FFmpeg
macOS:   brew install ffmpeg
```

모든 산출물은 `.recordings/` 에 저장 (gitignore 적용됨).

---

## 전체 파이프라인

```
녹화 → AI 분석 → 방향 감지 → 매칭 포맷 자동 생성
```

세로 게임이면 세로 포맷만, 가로 게임이면 가로 포맷만 생성.
크로스 방향 변환(세로→가로 등)은 기본적으로 하지 않음.

---

## Step 1: 녹화 (Record)

### 준비

```bash
# 1. 게임 서버 시작
npx serve game/ -p 3000 &

# 2. 브라우저 열기
agent-browser --headed open http://localhost:3000
```

### 캔버스 녹화 (scripts/canvas-record.js)

캔버스 네이티브 해상도를 그대로 캡처. VP9 8Mbps 60fps.

```bash
# 녹화 시작 — canvas-record.js를 base64로 주입
B64=$(cat scripts/canvas-record.js | base64 -w0)
agent-browser eval -b "$B64"
```

사용자에게 안내:
```
🎮 녹화가 시작되었습니다. 게임을 플레이하세요!
   완료되면 "녹화 중지"라고 말씀해 주세요.
   (권장: 1~3분 플레이)
```

녹화 중지 + 다운로드:
```bash
# 중지
B64_STOP=$(echo "window.__stopRecording()" | base64 -w0)
agent-browser eval -b "$B64_STOP"

# 2초 대기 (Blob 생성)
sleep 2

# 다운로드
agent-browser download "#__download_recording" ./.recordings/
```

### 외부 녹화 파일

OBS 등으로 직접 녹화한 파일도 사용 가능:
```
"이 영상으로 트레일러 만들어줘" + ./my-gameplay.mp4
```

---

## Step 2: AI 하이라이트 분석

codeb video로 Gemini에 영상을 분석 요청.

```bash
codeb video ./.recordings/gameplay-canvas.webm \
  -o ./.recordings/analysis.json \
  --format json --detail detailed \
  --prompt "게임 플레이 하이라이트를 분석해주세요. 각 하이라이트에 start_time(MM:SS), end_time(MM:SS), description, excitement_score(1-10)를 포함해주세요." \
  --keep
```

### highlights.json 변환

codeb video 출력은 마크다운/텍스트일 수 있으므로, 파싱하여 아래 형식으로 변환:

```json
{
  "highlights": [
    {
      "start_time": "00:06",
      "end_time": "00:17",
      "description": "고득점 러시 (Score 20~25)",
      "excitement_score": 8
    }
  ],
  "recommended_order": [1, 0, 2]
}
```

분석 결과를 사용자에게 보여주고 길이를 선택받기:
```
🎬 하이라이트 3개를 찾았습니다:
  [1] ★9  00:18-00:20 — 극적인 충돌 (Game Over)
  [2] ★8  00:06-00:17 — 고득점 러시 (Score 20~25)
  [3] ★6  00:00-00:05 — 안정적 주행 (Score 17~19)

📐 세로 게임 감지 (400×600)

영상 길이를 선택해 주세요:
  • 15초 — SNS 광고 (TikTok, Reels, Stories)
  • 30초 — 앱스토어 프리뷰 (iOS, Google Play)
```

사용자가 선택하면 해당 길이로 생성. 미선택 시 30초 기본.

---

## Step 3: 방향 감지 + 자동 생성

### 방향별 기본 출력 세트

소스 영상의 가로/세로 비율을 감지하여 매칭 포맷만 생성:

**세로 게임** (height > width):

| 프리셋 | 해상도 | 용도 |
|--------|--------|------|
| `vertical` | 1080×1920 | TikTok, Reels, Stories |
| `ios-portrait` | 886×1920 | iOS App Store |
| `meta-feed` | 1080×1350 | Meta Feed (4:5) |
| `square` | 1080×1080 | X, UAC, 범용 |

**가로 게임** (width > height):

| 프리셋 | 해상도 | 용도 |
|--------|--------|------|
| `landscape` / `gplay` | 1920×1080 | Google Play, YouTube |
| `ios-landscape` | 1920×886 | iOS App Store (가로) |
| `square` | 1080×1080 | X, UAC, 범용 |

### 실행

```bash
# 프리셋 미지정 시 자동 감지 (세로→vertical, 가로→gplay)
bash scripts/cut-highlights.sh \
  ./.recordings/gameplay-canvas.webm \
  ./.recordings/highlights.json \
  ./.recordings/output \
  --duration 30 --quality high
```

### ASO 스토어 프리뷰

세로 게임 기준:
```bash
# iOS App Store
bash scripts/cut-highlights.sh ... \
  ./.recordings/aso/ios --preset ios-portrait --duration 30 --quality high

# Google Play — 세로 게임이면 vertical로 업로드 (YouTube가 자동 처리)
bash scripts/cut-highlights.sh ... \
  ./.recordings/aso/gplay --preset vertical --duration 30 --quality high
```

### UA 광고 소재

```bash
# TikTok / Reels (9:16)
bash scripts/cut-highlights.sh ... --preset vertical --duration 15

# Meta Feed (4:5)
bash scripts/cut-highlights.sh ... --preset meta-feed --duration 15

# 정방형 (1:1)
bash scripts/cut-highlights.sh ... --preset square --duration 15
```

### 스크린샷 추출 (ASO용)

하이라이트 키프레임을 스토어 스크린샷으로 추출:
```bash
# 각 하이라이트 중간 지점에서 고해상도 프레임 추출
ffmpeg -i ./.recordings/gameplay-canvas.webm \
  -vf "select='eq(n\,180)+eq(n\,360)+eq(n\,540)',scale=1080:1920" \
  -vsync vfr -q:v 1 \
  ./.recordings/screenshots/screenshot_%02d.png
```

---

## 출력 구조

```
.recordings/
├── gameplay-canvas.webm          # 원본 녹화
├── analysis.json                 # codeb video 원본 출력
├── highlights.json               # 파싱된 하이라이트
└── output/
    ├── highlight-reel-30s.mp4    # 트레일러 영상
    ├── thumbnail.png             # 첫 프레임 썸네일
    ├── segments/                 # 개별 세그먼트
    └── screenshots/              # ASO 스크린샷 (하이라이트별 1장)
        ├── screenshot_00.png     #   → iOS: 1290×2796 권장, 1080×1920 허용
        ├── screenshot_01.png     #   → Google Play: 1080×1920 권장
        ├── screenshot_02.png     #   Google Play 최소 4장 필요
        └── screenshot_03.png
```

---

## 사용자 경험

### "게임 트레일러 만들어줘"

```
🎮 게임을 녹화하겠습니다. 브라우저를 열고 녹화를 시작합니다.

[녹화 시작]
🔴 녹화 중입니다. 게임을 플레이하세요!
   완료되면 "녹화 중지"라고 말씀해 주세요.

[녹화 중지 후]
🎬 AI가 하이라이트를 분석하고 있습니다...

📖 하이라이트 4개 발견:
  [1] ★8  01:00-01:03 — 파이프 충돌 Game Over
  [2] ★7  00:50-01:00 — 고득점 구간 (Score 12~16)
  [3] ★6  00:23-00:35 — 새 라운드, 리듬 회복
  [4] ★5  00:00-00:10 — 안정적 초반 플레이

📐 세로 게임 감지 (400×600)

영상 길이를 선택해 주세요:
  • 15초 — SNS 광고 (TikTok, Reels, Stories)
  • 30초 — 앱스토어 프리뷰 (iOS, Google Play)

[사용자: "30초"]

✂️ 클립 생성 중...
  vertical (1080×1920, 30s) ✓
📸 ASO 스크린샷 4장 추출 ✓

✅ 완료!
📁 .recordings/output/highlight-reel-30s.mp4
📸 .recordings/output/screenshots/ (4장)

미리보기를 열까요?
```

---

## 편집 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--duration` | 30 | 최종 영상 목표 길이(초) |
| `--preset` | 자동 (세로→vertical, 가로→gplay) | 출력 프리셋 |
| `--transition` | cut | cut / fade |
| `--quality` | medium | low(CRF 28) / medium(CRF 23) / high(CRF 18) |

## 프리셋 전체 목록

| 프리셋 | 해상도 | 비율 | 타겟 |
|--------|--------|------|------|
| `ios-portrait` | 886×1920 | ~9:19.5 | iOS App Store |
| `ios-landscape` | 1920×886 | ~19.5:9 | iOS 가로 게임 |
| `ios-ipad` | 1200×1600 | 3:4 | iPad App Store |
| `gplay` | 1920×1080 | 16:9 | Google Play |
| `meta-feed` | 1080×1350 | 4:5 | Meta Feed |
| `vertical` | 1080×1920 | 9:16 | TikTok, Reels |
| `landscape` | 1920×1080 | 16:9 | YouTube, Unity Ads |
| `square` | 1080×1080 | 1:1 | X, UAC, 범용 |

상세 규격: [references/aso-ua-specs.md](references/aso-ua-specs.md)

---

## 주의사항

- **캔버스 해상도**: canvas.captureStream은 캔버스 네이티브 해상도로 녹화. FFmpeg가 타겟 해상도로 스케일링
- **Gemini 1FPS 샘플링**: 타임스탬프 ±1초 오차 가능. 컷 지점에 0.5초 마진 자동 추가
- **최대 녹화 시간**: 3분 권장 (Gemini 분석 정밀도 + 비용)
- **방향 매칭**: 세로 게임→세로 포맷, 가로 게임→가로 포맷만 기본 생성. 크로스 변환은 crop 발생
