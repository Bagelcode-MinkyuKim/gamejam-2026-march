# game-eye CLI Reference (v0.5.1)

## Standalone Commands

### detect
엔진 감지.
```
game-eye detect <URL> [--head]
```

### screenshot
스크린샷 캡처.
```
game-eye screenshot <URL> [--viewport 1280x800] [-o output.png] [--head] [--wait-ms 3000]
```

### snapshot
씬 그래프 추출.
```
game-eye snapshot <URL> [--visible-only] [--max-depth N] [--wait-ms 3000] [--head] [--format yaml|json]
```

### debug-eval
JS 평가 (세션 없이).
```
game-eye debug-eval <URL> '<expression>' [--file <path>] [--wait-ms 2000]
```

### diff
두 스냅샷 비교.
```
game-eye diff <file1> <file2>
```

## Global Options
- `--format yaml|json` — 출력 형식 (기본: yaml)
- `--viewport WxH` — 브라우저 뷰포트 크기 (예: 1280x800)

---

## Session Commands

### session start
세션 시작 (블로킹, 별도 터미널에서 실행).
```
game-eye session start <URL> [--head] [--viewport 1280x800] [--wait-ms 3000]
```
- `--head`: 브라우저 창 표시 (시연/디버깅용)

### session stop
세션 종료.
```
game-eye session stop
```

### session reload
페이지 리로드 (세션 유지).
```
game-eye session reload
```

### session detect / snapshot / eval / screenshot
세션을 통한 기존 명령.
```
game-eye session detect
game-eye session snapshot [--visible-only]
game-eye session eval '<expression>'
game-eye session screenshot [-o output.png]
```

---

## Session Assert (v0.5.0)

### session assert
JS 조건 검증. $("name") 헬퍼로 씬 그래프 오브젝트 접근.
```
game-eye session assert '<expression>'
```
- 성공: exit 0, `pass: true`
- 실패: exit 1, `pass: false`, `context`에 $() 오브젝트 실제 값

$() 접근 가능 속성 (raw PixiJS DisplayObject):
- `.x`, `.y` — 위치 (px)
- `.width`, `.height` — 크기 (px)
- `.visible` — 가시성 (bool)
- `.alpha` — 투명도 (0.0~1.0)
- `.rotation` — 회전 (radians)
- `.scale.x`, `.scale.y` — 스케일
- `.text` — 텍스트 (Text 오브젝트)
- `.label` / `.name` — 이름
- `.children` — 자식 배열 (`.children.length`로 개수)
- `.interactive` — 포인터 이벤트 여부 (bool)
- `.parent` — 부모 컨테이너 참조

실패 시 context에는 위 속성의 스냅샷 + `.childCount` (children.length 요약)이 포함됨.

### session assert-no-errors
uncaught 에러 + 네트워크 에러 제로 검증.
```
game-eye session assert-no-errors
```

### session wait-until
조건 충족까지 폴링 대기.
```
game-eye session wait-until '<expression>' [--timeout 5000] [--interval 200]
```

---

## Session Input

### session input
단일 입력.
```
game-eye session input --key <KeyName>
game-eye session input --key <KeyName> --repeat 5 --delay 100
game-eye session input --action move --click-x 400 --click-y 300
game-eye session input --action drag --click-x 100 --click-y 100 --to-x 400 --to-y 400
game-eye session input --action scroll --click-x 400 --click-y 300 --delta-y -300
```

### session replay
연속 키 입력.
```
game-eye session replay --keys "ArrowUp,ArrowLeft,Space" [--delay 100] [--wait-frame]
```
- `--delay <ms>`: 키 사이 대기 시간
- `--wait-frame`: 2 rAF 대기 후 다음 키 (애니메이션 게임에서는 --delay와 조합 필수)

---

## Session Monitoring

### session console
콘솔 로그 조회.
```
game-eye session console [--clear]
```
출력: `entries[]` — level (log/warn/error/debug/info), message, timestamp

### session network-errors
네트워크 에러 조회.
```
game-eye session network-errors [--clear]
```
출력: `errors[]` — 4xx/5xx/fetch 실패

---

## Session Misc

### session watch
씬 변화 실시간 스트리밍.
```
game-eye session watch [--interval 200] [--max 3]
```

### session ping
세션 서버 헬스 체크.
```
game-eye session ping
```

### session list
활성 세션 목록.
```
game-eye session list
```

---

## Environment Variables

| 변수 | 설명 | 기본값 |
|---|---|---|
| `RUST_LOG` | 로그 레벨 (debug, info, error) | `game_eye=info` |
| `CHROME_PATH` | Chrome/Chromium 경로 | 자동 감지 |
