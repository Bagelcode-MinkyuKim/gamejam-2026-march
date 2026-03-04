#!/usr/bin/env bash
# cut-highlights.sh — highlights.json 기반 FFmpeg 컷편집
#
# 사용법:
#   bash cut-highlights.sh <input-video> <highlights-json> <output-dir> [options]
#
# 옵션:
#   --duration <sec>    최종 영상 목표 길이 (기본: 30)
#   --preset <name>     프리셋 이름 (기본: gplay)
#   --transition <type> cut|fade (기본: cut)
#   --quality <level>   low|medium|high (기본: medium)
#
# ASO 프리셋:
#   ios-portrait    886x1920   iOS App Store (iPhone, 필수)
#   ios-landscape   1920x886   iOS App Store (가로 게임)
#   ios-ipad        1200x1600  iPad App Store
#   gplay           1920x1080  Google Play (YouTube)
#
# UA 프리셋:
#   meta-feed       1080x1350  Meta Feed 광고 (4:5 신규 표준)
#   vertical        1080x1920  TikTok, Stories, Reels (9:16)
#   landscape       1920x1080  YouTube, Unity Ads (16:9)
#   square          1080x1080  X, UAC, 범용 (1:1)
#
# 예시:
#   bash cut-highlights.sh gameplay.webm highlights.json ./output
#   bash cut-highlights.sh gameplay.webm highlights.json ./output --duration 15 --preset meta-feed
#   bash cut-highlights.sh gameplay.webm highlights.json ./output --preset ios-portrait --quality high

set -euo pipefail

# ---- 인자 파싱 ----
INPUT_VIDEO="${1:?사용법: cut-highlights.sh <input-video> <highlights-json> <output-dir>}"
HIGHLIGHTS_JSON="${2:?highlights.json 경로를 지정하세요}"
OUTPUT_DIR="${3:?출력 디렉토리를 지정하세요}"

# 기본값
DURATION=30
PRESET=""
TRANSITION="cut"
QUALITY="medium"

shift 3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)   DURATION="$2"; shift 2 ;;
    --preset)     PRESET="$2"; shift 2 ;;
    --transition) TRANSITION="$2"; shift 2 ;;
    --quality)    QUALITY="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

# ---- FFmpeg 확인 ----
if ! command -v ffmpeg &>/dev/null; then
  echo "ERROR: FFmpeg가 설치되어 있지 않습니다." >&2
  echo "" >&2
  echo "설치 방법:" >&2
  echo "  Windows: winget install Gyan.FFmpeg" >&2
  echo "  macOS:   brew install ffmpeg" >&2
  echo "  Linux:   sudo apt install ffmpeg" >&2
  exit 1
fi

# ---- jq 또는 python JSON 파서 확인 ----
if command -v jq &>/dev/null; then
  JSON_PARSER="jq"
elif command -v python3 &>/dev/null; then
  JSON_PARSER="python3"
elif command -v python &>/dev/null; then
  JSON_PARSER="python"
else
  echo "ERROR: jq 또는 python이 필요합니다 (JSON 파싱용)" >&2
  exit 1
fi

# ---- 프리셋 자동 선택 (소스 비율 감지) ----
if [[ -z "$PRESET" ]]; then
  SRC_W=$(ffprobe -v quiet -select_streams v:0 -show_entries stream=width -of csv=p=0 "$INPUT_VIDEO" 2>/dev/null | head -1)
  SRC_H=$(ffprobe -v quiet -select_streams v:0 -show_entries stream=height -of csv=p=0 "$INPUT_VIDEO" 2>/dev/null | head -1)
  if [[ -n "$SRC_W" && -n "$SRC_H" && "$SRC_H" -gt "$SRC_W" ]]; then
    PRESET="vertical"
    echo "📐 세로 영상 감지 (${SRC_W}x${SRC_H}) → vertical 프리셋 자동 선택"
  else
    PRESET="gplay"
    echo "📐 가로 영상 감지 (${SRC_W}x${SRC_H}) → gplay 프리셋 자동 선택"
  fi
fi

# ---- 프리셋 설정 ----
case "$PRESET" in
  # ASO 프리셋
  ios-portrait)  WIDTH=886;  HEIGHT=1920 ;;  # iOS App Store iPhone
  ios-landscape) WIDTH=1920; HEIGHT=886 ;;   # iOS App Store 가로 게임
  ios-ipad)      WIDTH=1200; HEIGHT=1600 ;;  # iPad App Store
  gplay)         WIDTH=1920; HEIGHT=1080 ;;  # Google Play (YouTube 16:9)
  # UA 프리셋
  meta-feed)     WIDTH=1080; HEIGHT=1350 ;;  # Meta Feed (4:5 신규 표준)
  vertical)      WIDTH=1080; HEIGHT=1920 ;;  # TikTok, Stories, Reels (9:16)
  landscape)     WIDTH=1920; HEIGHT=1080 ;;  # YouTube, Unity Ads (16:9)
  square)        WIDTH=1080; HEIGHT=1080 ;;  # X, UAC, 범용 (1:1)
  # 레거시 호환
  aso-landscape) WIDTH=1920; HEIGHT=1080 ;;
  aso-portrait)  WIDTH=1080; HEIGHT=1920 ;;
  ua-square)     WIDTH=1080; HEIGHT=1080 ;;
  *) echo "알 수 없는 프리셋: $PRESET" >&2
     echo "ASO: ios-portrait|ios-landscape|ios-ipad|gplay" >&2
     echo "UA:  meta-feed|vertical|landscape|square" >&2
     exit 1 ;;
esac

# ---- 품질 설정 (CRF) ----
case "$QUALITY" in
  low)    CRF=28 ;;
  medium) CRF=23 ;;
  high)   CRF=18 ;;
  *) echo "알 수 없는 품질: $QUALITY (low|medium|high)" >&2; exit 1 ;;
esac

# ---- 디렉토리 생성 ----
SEGMENTS_DIR="${OUTPUT_DIR}/segments"
mkdir -p "$SEGMENTS_DIR"

# ---- 오디오 스트림 감지 ----
if ffprobe -v quiet -select_streams a -show_entries stream=codec_type -of csv=p=0 "$INPUT_VIDEO" 2>/dev/null | grep -q audio; then
  AUDIO_OPTS="-c:a aac -b:a 128k"
else
  AUDIO_OPTS="-an"
fi

# ---- MM:SS → 초 변환 ----
mmss_to_seconds() {
  local time="$1"
  local min="${time%%:*}"
  local sec="${time##*:}"
  echo $(( 10#$min * 60 + 10#$sec ))
}

# ---- highlights.json 파싱 ----
echo "📖 하이라이트 분석 결과 로딩: ${HIGHLIGHTS_JSON}"

if [[ "$JSON_PARSER" == "jq" ]]; then
  HIGHLIGHT_COUNT=$(jq '.highlights | length' "$HIGHLIGHTS_JSON")
  # recommended_order가 있으면 사용, 없으면 excitement_score 내림차순
  if jq -e '.recommended_order' "$HIGHLIGHTS_JSON" &>/dev/null; then
    ORDER=$(jq -r '.recommended_order | .[]' "$HIGHLIGHTS_JSON")
  else
    ORDER=$(jq -r '.highlights | to_entries | sort_by(-.value.excitement_score) | .[].key' "$HIGHLIGHTS_JSON")
  fi
else
  # Python 폴백
  HIGHLIGHT_COUNT=$($JSON_PARSER -c "
import json, sys
data = json.load(open('$HIGHLIGHTS_JSON', encoding='utf-8'))
print(len(data['highlights']))
")
  ORDER=$($JSON_PARSER -c "
import json
data = json.load(open('$HIGHLIGHTS_JSON', encoding='utf-8'))
if 'recommended_order' in data and data['recommended_order']:
    for i in data['recommended_order']: print(i)
else:
    ranked = sorted(range(len(data['highlights'])), key=lambda i: -data['highlights'][i].get('excitement_score', 0))
    for i in ranked: print(i)
")
fi

echo "🎬 하이라이트 ${HIGHLIGHT_COUNT}개 발견"

# ---- 세그먼트 추출 ----
echo ""
echo "✂️  세그먼트 추출 중..."

TOTAL_CUT_DURATION=0
SEGMENT_FILES=()
SEGMENT_IDX=0

for IDX in $ORDER; do
  # 목표 길이 도달 시 중단
  if (( TOTAL_CUT_DURATION >= DURATION )); then
    break
  fi

  # 하이라이트 정보 추출
  if [[ "$JSON_PARSER" == "jq" ]]; then
    START_TIME=$(jq -r ".highlights[$IDX].start_time" "$HIGHLIGHTS_JSON")
    END_TIME=$(jq -r ".highlights[$IDX].end_time" "$HIGHLIGHTS_JSON")
    DESC=$(jq -r ".highlights[$IDX].description" "$HIGHLIGHTS_JSON")
  else
    read -r START_TIME END_TIME DESC <<< "$(PYTHONIOENCODING=utf-8 $JSON_PARSER -c "
import json
data = json.load(open('$HIGHLIGHTS_JSON', encoding='utf-8'))
h = data['highlights'][$IDX]
print(h['start_time'], h['end_time'], h.get('description',''))
")"
  fi

  START_SEC=$(mmss_to_seconds "$START_TIME")
  END_SEC=$(mmss_to_seconds "$END_TIME")
  SEG_DURATION=$((END_SEC - START_SEC))

  # 마진 추가 (±0.5초, Gemini 1FPS 오차 보정)
  START_WITH_MARGIN=$(awk "BEGIN{v=$START_SEC-0.5; print (v<0)?0:v}")
  END_WITH_MARGIN=$(awk "BEGIN{print $END_SEC+0.5}")

  SEGMENT_FILE="${SEGMENTS_DIR}/segment_$(printf '%02d' $SEGMENT_IDX).mp4"

  echo "  [$SEGMENT_IDX] ${START_TIME}-${END_TIME} (${SEG_DURATION}s) — ${DESC}"

  # 스케일 + 크롭: 동일 방향이면 크롭 최소, 크로스 방향이면 중앙 크롭
  ffmpeg -y -hide_banner -loglevel warning \
    -i "$INPUT_VIDEO" \
    -ss "$START_WITH_MARGIN" -to "$END_WITH_MARGIN" \
    -vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}" \
    -c:v libx264 -crf "$CRF" -preset fast \
    ${AUDIO_OPTS} \
    -movflags +faststart \
    "$SEGMENT_FILE"

  SEGMENT_FILES+=("$SEGMENT_FILE")
  TOTAL_CUT_DURATION=$((TOTAL_CUT_DURATION + SEG_DURATION))
  SEGMENT_IDX=$((SEGMENT_IDX + 1))
done

echo ""
echo "📦 세그먼트 ${#SEGMENT_FILES[@]}개 추출 완료 (총 ${TOTAL_CUT_DURATION}초)"

# ---- 세그먼트 결합 ----
if [[ ${#SEGMENT_FILES[@]} -eq 0 ]]; then
  echo "ERROR: 추출된 세그먼트가 없습니다" >&2
  exit 1
fi

CONCAT_LIST="${OUTPUT_DIR}/concat-list.txt"
> "$CONCAT_LIST"
for f in "${SEGMENT_FILES[@]}"; do
  # segments/ 하위 파일명만 사용 (concat -safe 0 + 상대경로)
  echo "file 'segments/$(basename "$f")'" >> "$CONCAT_LIST"
done

OUTPUT_FILE="${OUTPUT_DIR}/highlight-reel-${DURATION}s.mp4"

echo ""
echo "🔗 세그먼트 결합 중..."

if [[ "$TRANSITION" == "fade" ]]; then
  # 페이드 인/아웃 적용 + 목표 길이로 트림
  ffmpeg -y -hide_banner -loglevel warning \
    -f concat -safe 0 -i "$CONCAT_LIST" \
    -t "$DURATION" \
    -vf "fade=in:0:15,fade=out:st=$((DURATION > 2 ? DURATION - 2 : 0)):d=2" \
    -c:v libx264 -crf "$CRF" -preset fast \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    "$OUTPUT_FILE"
else
  # 단순 결합 + 목표 길이로 트림
  ffmpeg -y -hide_banner -loglevel warning \
    -f concat -safe 0 -i "$CONCAT_LIST" \
    -t "$DURATION" \
    -c copy \
    -movflags +faststart \
    "$OUTPUT_FILE"
fi

# ---- 썸네일 추출 ----
THUMBNAIL="${OUTPUT_DIR}/thumbnail.png"
ffmpeg -y -hide_banner -loglevel warning \
  -i "$OUTPUT_FILE" \
  -vf "select=eq(n\,0)" -vframes 1 \
  -update 1 \
  "$THUMBNAIL"

# ---- ASO 스크린샷 추출 ----
SCREENSHOTS_DIR="${OUTPUT_DIR}/screenshots"
mkdir -p "$SCREENSHOTS_DIR"

echo ""
echo "🖼️  ASO 스크린샷 추출 중..."

SHOT_IDX=0
for IDX in $ORDER; do
  # 하이라이트 중간 지점 계산
  if [[ "$JSON_PARSER" == "jq" ]]; then
    START_TIME=$(jq -r ".highlights[$IDX].start_time" "$HIGHLIGHTS_JSON")
    END_TIME=$(jq -r ".highlights[$IDX].end_time" "$HIGHLIGHTS_JSON")
  else
    read -r START_TIME END_TIME <<< "$(PYTHONIOENCODING=utf-8 $JSON_PARSER -c "
import json
data = json.load(open('$HIGHLIGHTS_JSON', encoding='utf-8'))
h = data['highlights'][$IDX]
print(h['start_time'], h['end_time'])
")"
  fi

  START_SEC=$(mmss_to_seconds "$START_TIME")
  END_SEC=$(mmss_to_seconds "$END_TIME")
  MID_SEC=$(( (START_SEC + END_SEC) / 2 ))

  SHOT_FILE="${SCREENSHOTS_DIR}/screenshot_$(printf '%02d' $SHOT_IDX).png"
  ffmpeg -y -hide_banner -loglevel warning \
    -i "$INPUT_VIDEO" \
    -ss "$MID_SEC" -vframes 1 \
    -vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}" \
    -update 1 \
    "$SHOT_FILE"

  SHOT_IDX=$((SHOT_IDX + 1))
done

echo "  스크린샷 ${SHOT_IDX}장 → ${SCREENSHOTS_DIR}/"

# ---- 임시 파일 정리 ----
rm -f "$CONCAT_LIST"

# ---- 결과 ----
echo ""
echo "✅ 트레일러 생성 완료!"
echo "📁 ${OUTPUT_FILE}"
echo "🖼️  ${THUMBNAIL}"
echo "📸 스크린샷 ${SHOT_IDX}장: ${SCREENSHOTS_DIR}/"
echo "🎞️  세그먼트 ${#SEGMENT_FILES[@]}개: ${SEGMENTS_DIR}/"
echo ""
echo "프리셋: ${PRESET} (${WIDTH}x${HEIGHT})"
echo "품질: ${QUALITY} (CRF ${CRF})"
# 실제 출력 길이 표시
ACTUAL_DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUTPUT_FILE" 2>/dev/null | cut -d. -f1)
echo "길이: ${ACTUAL_DURATION:-$DURATION}초"
