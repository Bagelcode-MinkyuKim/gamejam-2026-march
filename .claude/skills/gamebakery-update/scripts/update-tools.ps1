#!/usr/bin/env pwsh
# GameBakery.ai 도구 및 스킬 업데이트 (Windows)
# 사용법: .\update-tools.ps1 [-ToolsOnly] [-SkillsOnly]
param(
    [switch]$ToolsOnly,
    [switch]$SkillsOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..\..") | Select-Object -ExpandProperty Path
$GitHubRepo = "project-bakery/gamejam-template"

Write-Output ""
Write-Output "========================================="
Write-Output "  GameBakery.ai 업데이트"
Write-Output "========================================="
Write-Output "  프로젝트: $ProjectRoot"
Write-Output ""

# ── 도구 업데이트 ──
if (-not $SkillsOnly) {
    Write-Output "=== 도구 업데이트 ==="

    # codeb
    try {
        $codebVer = & codeb version 2>&1 | Select-Object -First 1
        Write-Output "[codeb] 현재: $codebVer"
        Write-Output "[codeb] 업데이트 중..."
        & codeb upgrade
    } catch {
        Write-Output "[codeb] 미설치 또는 업데이트 실패"
    }
    Write-Output ""

    # game-eye
    try {
        $gameEyeVer = & game-eye --version 2>&1 | Select-Object -First 1
        Write-Output "[game-eye] 현재: $gameEyeVer"
        Write-Output "[game-eye] 업데이트 중..."
        & game-eye upgrade
    } catch {
        Write-Output "[game-eye] 미설치 또는 업데이트 실패"
    }
    Write-Output ""

}

# ── 스킬 업데이트 ──
if (-not $ToolsOnly) {
    Write-Output "=== 스킬 업데이트 ==="

    Write-Output "최신 릴리스 확인 중..."
    try {
        $release = Invoke-RestMethod "https://api.github.com/repos/$GitHubRepo/releases/latest"
        $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1

        if (-not $zipAsset) {
            Write-Output "릴리스 zip을 찾을 수 없습니다"
            exit 1
        }

        $zipUrl = $zipAsset.browser_download_url
        Write-Output "다운로드: $zipUrl"

        $tmpDir = Join-Path $env:TEMP "gamebakery-update-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $tmpZip = Join-Path $tmpDir "gamebakery-update.zip"

        New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
        Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing
        Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

        # zip 내 폴더 찾기
        $extracted = Get-ChildItem -Path $tmpDir -Directory | Select-Object -First 1

        if (-not $extracted) {
            Write-Output "zip 추출 실패"
            Remove-Item -Recurse -Force $tmpDir
            exit 1
        }

        Write-Output "스킬 교체 중..."
        $extractedPath = $extracted.FullName

        # 스킬/규칙 디렉토리 교체
        foreach ($cliDir in @(".claude", ".gemini", ".codex", ".agent")) {
            $skillsSrc = Join-Path $extractedPath "$cliDir\skills"
            $skillsDst = Join-Path $ProjectRoot "$cliDir\skills"
            if (Test-Path $skillsSrc) {
                if (Test-Path $skillsDst) { Remove-Item -Recurse -Force $skillsDst }
                Copy-Item -Path $skillsSrc -Destination $skillsDst -Recurse
                Write-Output "  [OK] $cliDir\skills\"
            }

            $rulesSrc = Join-Path $extractedPath "$cliDir\rules"
            $rulesDst = Join-Path $ProjectRoot "$cliDir\rules"
            if (Test-Path $rulesSrc) {
                if (Test-Path $rulesDst) { Remove-Item -Recurse -Force $rulesDst }
                Copy-Item -Path $rulesSrc -Destination $rulesDst -Recurse
                Write-Output "  [OK] $cliDir\rules\"
            }
        }

        # AGENTS.md 교체
        $agentsSrc = Join-Path $extractedPath "AGENTS.md"
        if (Test-Path $agentsSrc) {
            Copy-Item -Path $agentsSrc -Destination (Join-Path $ProjectRoot "AGENTS.md") -Force
            Write-Output "  [OK] AGENTS.md"
        }

        # 정리
        Remove-Item -Recurse -Force $tmpDir
    } catch {
        Write-Output "스킬 업데이트 실패: $_"
    }
    Write-Output ""
}

Write-Output "========================================="
Write-Output "  업데이트 완료!"
Write-Output "========================================="
Write-Output ""

Write-Output "현재 도구 버전:"
try { & codeb version 2>&1 | Select-Object -First 1 } catch { Write-Output "  codeb: 미설치" }
try { & game-eye --version 2>&1 | Select-Object -First 1 } catch { Write-Output "  game-eye: 미설치" }
Write-Output ""
