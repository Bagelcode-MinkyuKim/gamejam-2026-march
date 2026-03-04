#!/usr/bin/env bash
# GameBakery.ai 도구 및 스킬 업데이트
# 사용법: bash update-tools.sh [--tools-only | --skills-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
GITHUB_REPO="project-bakery/gamejam-template"

MODE="${1:-all}"  # all, --tools-only, --skills-only

echo ""
echo "========================================="
echo "  GameBakery.ai 업데이트"
echo "========================================="
echo "  프로젝트: ${PROJECT_ROOT}"
echo "  모드: ${MODE}"
echo ""

# ── 도구 업데이트 ──
if [ "${MODE}" != "--skills-only" ]; then
    echo "=== 도구 업데이트 ==="

    # codeb
    if command -v codeb > /dev/null 2>&1; then
        echo "[codeb] 현재: $(codeb version 2>&1 | head -1)"
        echo "[codeb] 업데이트 중..."
        codeb upgrade || echo "[codeb] 업데이트 실패 — 수동으로 시도하세요: codeb upgrade --force"
    else
        echo "[codeb] 미설치 — install-tools.sh를 먼저 실행하세요"
    fi
    echo ""

    # game-eye
    if command -v game-eye > /dev/null 2>&1; then
        echo "[game-eye] 현재: $(game-eye --version 2>&1 | head -1)"
        echo "[game-eye] 업데이트 중..."
        game-eye upgrade || echo "[game-eye] 업데이트 실패"
    else
        echo "[game-eye] 미설치 — install-tools.sh를 먼저 실행하세요"
    fi
    echo ""

fi

# ── 스킬 업데이트 ──
if [ "${MODE}" != "--tools-only" ]; then
    echo "=== 스킬 업데이트 ==="

    # GitHub API로 최신 릴리스 zip URL 가져오기
    echo "최신 릴리스 확인 중..."
    RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null || echo "")

    if [ -z "${RELEASE_JSON}" ]; then
        echo "GitHub API 접근 실패 — 네트워크를 확인하세요"
        exit 1
    fi

    ZIP_URL=$(echo "${RELEASE_JSON}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for asset in data.get('assets', []):
    if asset['name'].endswith('.zip'):
        print(asset['browser_download_url'])
        break
" 2>/dev/null || echo "")

    if [ -z "${ZIP_URL}" ]; then
        echo "릴리스 zip을 찾을 수 없습니다"
        exit 1
    fi

    echo "다운로드: ${ZIP_URL}"
    TMP_DIR=$(mktemp -d)
    TMP_ZIP="${TMP_DIR}/gamebakery-update.zip"

    curl -fSL -o "${TMP_ZIP}" "${ZIP_URL}"
    unzip -q "${TMP_ZIP}" -d "${TMP_DIR}"

    # zip 내 폴더 이름 찾기
    EXTRACTED=$(ls -d "${TMP_DIR}"/*/ | head -1)

    if [ -z "${EXTRACTED}" ]; then
        echo "zip 추출 실패"
        rm -rf "${TMP_DIR}"
        exit 1
    fi

    echo "스킬 교체 중..."

    # 스킬 디렉토리 교체
    for cli_dir in .claude .gemini .codex .agent; do
        if [ -d "${EXTRACTED}${cli_dir}/skills" ]; then
            rm -rf "${PROJECT_ROOT}/${cli_dir}/skills"
            cp -r "${EXTRACTED}${cli_dir}/skills" "${PROJECT_ROOT}/${cli_dir}/skills"
            echo "  [OK] ${cli_dir}/skills/"
        fi
        if [ -d "${EXTRACTED}${cli_dir}/rules" ]; then
            rm -rf "${PROJECT_ROOT}/${cli_dir}/rules"
            cp -r "${EXTRACTED}${cli_dir}/rules" "${PROJECT_ROOT}/${cli_dir}/rules"
            echo "  [OK] ${cli_dir}/rules/"
        fi
    done

    # AGENTS.md 교체
    if [ -f "${EXTRACTED}AGENTS.md" ]; then
        cp "${EXTRACTED}AGENTS.md" "${PROJECT_ROOT}/AGENTS.md"
        echo "  [OK] AGENTS.md"
    fi

    # 정리
    rm -rf "${TMP_DIR}"
    echo ""
fi

echo "========================================="
echo "  업데이트 완료!"
echo "========================================="
echo ""

# 버전 확인
echo "현재 도구 버전:"
codeb version 2>/dev/null || echo "  codeb: 미설치"
game-eye --version 2>/dev/null || echo "  game-eye: 미설치"
echo ""
