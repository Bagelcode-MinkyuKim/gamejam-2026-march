---
name: asset-preview
description: Preview 3D models (GLB/GLTF/FBX) in the browser. Opens a lightweight Three.js viewer to inspect models, rigging, and animations between asset generation stages. Use when the user needs to visually verify a 3D model before proceeding to the next pipeline stage (rig, animate, game integration). Triggers on "preview model", "show 3D model", "model preview", "모델 미리보기", "3D 프리뷰", "에셋 확인", "모델 확인"
---

# Asset Preview — 3D 모델 브라우저 프리뷰

3D 에셋 생성 중간 단계에서 GLB/GLTF 모델을 브라우저로 미리보는 도구.
별도 설치 없이 CDN Three.js로 동작한다.

## 절차

### Step 1: 뷰어 HTML 생성

프로젝트 루트에 `.asset-preview/viewer.html`이 없으면 [references/viewer-template.md](references/viewer-template.md)의 내용을 `.asset-preview/viewer.html`로 생성한다.

```bash
mkdir -p .asset-preview
# viewer-template.md의 HTML 내용을 .asset-preview/viewer.html에 작성
```

`.asset-preview/`를 `.gitignore`에 추가 권장 (임시 뷰어이므로 커밋 불필요):

```bash
echo ".asset-preview/" >> .gitignore
```

### Step 2: 로컬 서버 시작

game-preview와 동일한 방식으로 서버를 시작한다. 포트 충돌을 피해 **3001** 이상을 사용한다.

```bash
npx serve . -p 3001 --no-clipboard &
```

이미 game-preview가 3000에서 실행 중이면 그 서버를 재사용해도 된다.

### Step 3: 브라우저에서 열기

```
http://localhost:3001/.asset-preview/viewer?model=/assets/models/knight.glb
```

**주의 — URL 규칙:**
- `model` 파라미터는 **절대경로** (`/assets/models/...`) 사용 필수. 상대경로 사용 시 뷰어 위치(`.asset-preview/`) 기준으로 해석되어 404 에러 발생
- `npx serve`의 Clean URL 기능으로 `.html` 확장자가 리다이렉트됨. **`.html` 없이** `viewer`로 접근

### Step 4: Director에게 프리뷰 안내

> 3D 모델 프리뷰를 열었습니다: http://localhost:<port>/.asset-preview/viewer?model=/<path>
>
> 조작법:
> - 마우스 왼쪽 드래그: 회전
> - 마우스 휠: 줌
> - 마우스 오른쪽 드래그: 이동
>
> 화면에 표시되는 정보:
> - 삼각형(폴리곤) 수
> - 모델 크기
> - 애니메이션 목록 (있으면 자동 재생)

### Step 5: game-eye 스크린샷 (선택)

에이전트가 모델 상태를 AI로 판단하고 싶으면 game-eye로 스크린샷을 캡처할 수 있다:

```bash
game-eye screenshot "http://localhost:<port>/.asset-preview/viewer?model=/assets/models/knight.glb" --viewport 800x600 -o .asset-preview/preview.png
```

이 스크린샷을 읽으면 에이전트가 모델의 시각적 품질을 판단할 수 있다.

## 주의사항

- `.asset-preview/` 디렉토리는 `.gitignore`에 추가 권장
- 뷰어는 CDN에서 Three.js를 로드하므로 **인터넷 연결 필요**
- 기존 game-preview 서버가 3000 포트에서 실행 중이면 3001 사용
- GLB/GLTF와 FBX 모두 지원 (확장자로 자동 분기)
