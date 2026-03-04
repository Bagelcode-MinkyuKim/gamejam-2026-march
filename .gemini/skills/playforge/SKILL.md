---
name: playforge-build
description: Remote build HTML5 games into Android APK/AAB. Uploads game files to the build server and generates APK/AAB — no local Java or Android SDK required. Triggers on "build APK", "build AAB", "Android build", "playforge build", "remote build", "빌드해줘", "APK 만들어줘", "앱으로 만들어줘"
---

# playforge — HTML5 게임을 Android 앱으로 리모트 빌드

HTML5 게임(PixiJS, Three.js 등)을 빌드 서버에서 Android APK/AAB로 패키징합니다.
Java, Android SDK 등 로컬 환경 설정이 필요 없습니다.

> **일상적인 테스트에는 이 스킬이 필요하지 않습니다.**
> PC/모바일 브라우저에서 게임을 확인하려면 `game-preview` 스킬("게임 실행해줘")을 사용하세요.
> 로컬 서버가 뜨며, 같은 Wi-Fi의 모바일 기기에서도 IP+포트로 즉시 접속할 수 있습니다.
>
> **이 스킬은 실제 Android APK/AAB 파일이 필요한 경우에만 사용합니다:**
> - 네이티브 앱으로 기기에 설치해서 테스트하고 싶을 때
> - Google Play Store에 제출할 AAB가 필요할 때

## 사전 확인

### Step 0: 모바일 호환성 검사 (자동)

APK/AAB 빌드 전에 **반드시** mobile-check 스킬을 실행한다. 이 단계를 생략하지 않는다.

```
mobile-check 실행 → PASS 시 빌드 진행
                  → FAIL 시 문제 항목을 사용자에게 보여주고, 수정 후 재검사
```

빌드 후 실패하면 시간 낭비이므로, 빌드 전에 잡는다.

### 프로젝트 구조 확인
- `index.html`이 존재하는지 확인
- 게임 파일이 하나의 디렉토리에 모여 있는지 확인

### 사용자에게 확인할 정보
- **appName**: 앱 이름 (예: "My Game")
- **packageName**: 패키지명 (예: "com.company.mygame")
- **orientation**: 화면 방향 (landscape / portrait / auto)
- **buildType**: 빌드 타입 (debug / release)

---

## 리모트 빌드 절차

### 빌드 서버
- URL: `${PLAYFORGE_BUILD_SERVER:-http://34.64.68.172:3100}`
- 환경 변수 `PLAYFORGE_BUILD_SERVER`로 오버라이드 가능

### 1단계: 게임 파일 압축

**macOS / Linux:**
```bash
zip -r /tmp/playforge-game.zip . -x ".*" -x "__MACOSX/*" -x "dist/*" -x "*.apk" -x "*.aab"
```

**Windows (PowerShell):**
```powershell
Compress-Archive -Path * -DestinationPath $env:TEMP\playforge-game.zip -Force
```

### 2단계: 빌드 요청

```bash
curl -X POST "${PLAYFORGE_BUILD_SERVER:-http://34.64.68.172:3100}/builds" \
  -F "gameZip=@/tmp/playforge-game.zip" \
  -F "appName=<appName>" \
  -F "packageName=<packageName>" \
  -F "orientation=<orientation>" \
  -F "buildType=<debug|release>"
```

응답에서 `buildId`를 추출합니다.

### 3단계: 빌드 대기 (10초 간격 폴링)

```bash
while true; do
  RESULT=$(curl -s "${PLAYFORGE_BUILD_SERVER:-http://34.64.68.172:3100}/builds/<buildId>")
  STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  MESSAGE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['message'])")

  echo "$MESSAGE"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  sleep 10
done
```

`message` 필드를 매 폴링마다 사용자에게 전달합니다 (큐 위치, 예상 대기 시간 등).

**Windows (PowerShell):**
```powershell
do {
    $result = Invoke-RestMethod "${env:PLAYFORGE_BUILD_SERVER ?? 'http://34.64.68.172:3100'}/builds/<buildId>"
    Write-Output $result.message
    Start-Sleep -Seconds 10
} while ($result.status -notin @('completed', 'failed'))
```

### 4단계: 결과물 다운로드

```bash
mkdir -p dist

# 디버그 APK
curl -o "dist/<appName>-debug.apk" \
  "${PLAYFORGE_BUILD_SERVER:-http://34.64.68.172:3100}/builds/<buildId>/artifact?type=apk"

# 릴리즈 AAB
curl -o "dist/<appName>-release.aab" \
  "${PLAYFORGE_BUILD_SERVER:-http://34.64.68.172:3100}/builds/<buildId>/artifact?type=aab"
```

---

## 결과 보고

빌드 완료 후 사용자에게 안내:
- 결과물 파일 경로 및 크기
- 빌드 타입 (debug/release)
- **디버그**: "기기에 설치: `adb install dist/<appName>-debug.apk`"
- **릴리즈**: "AAB 파일을 Google Play Console에서 업로드하세요"
