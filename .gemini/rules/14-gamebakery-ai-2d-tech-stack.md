# GameBakery.ai 2D Tech Stack

## Core Tech Stack

| 레이어 | 기술 | 용도 |
|--------|------|------|
| 렌더링 | **PixiJS + @pixi/react** | 2D 그래픽 렌더링 (WebGL/Canvas) |
| UI | React | 컴포넌트 기반 UI |
| 언어 | TypeScript | 타입 안전성, AI 친화적 |
| 빌드 | Vite | 빠른 개발 서버, 번들링 |
| 테스트 | Vitest | 단위/통합 테스트 |

## Why @pixi/react?
1. **React Ecosystem**: React 컴포넌트로 2D 씬을 선언적으로 구성한다.
2. **Performance**: PixiJS의 WebGL 성능을 그대로 활용한다.
3. **Consistency**: 3D 스택(React Three Fiber)과 동일한 패러다임.
4. **AI-Friendly**: 컴포넌트 구조가 명확하여 AI가 코드를 생성하기 쉽다.

## PixiJS Rules
1. **@pixi/react First**: React 컴포넌트로 PixiJS를 사용한다.
2. **Latest Version**: PixiJS v8 이상을 사용한다.
3. **No Other Renderers**: 다른 2D 렌더링 라이브러리(Phaser 등)는 사용하지 않는다.

## Setup
```bash
npm create vite@latest -- --template react-ts
npm install pixi.js @pixi/react
npm install -D vitest
```
