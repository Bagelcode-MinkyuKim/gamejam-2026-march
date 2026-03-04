# GameBakery.ai 3D Tech Stack

## Core Tech Stack

| 레이어 | 기술 | 용도 |
|--------|------|------|
| 렌더링 | **Three.js + React Three Fiber** | 3D 그래픽 렌더링 (WebGL) |
| 언어 | TypeScript | 타입 안전성, AI 친화적 |
| 빌드 | Vite | 빠른 개발 서버, 번들링 |
| 테스트 | Vitest | 단위/통합 테스트 |

## Why React Three Fiber?
1. **React Ecosystem**: React 컴포넌트로 3D 씬을 선언적으로 구성한다.
2. **Performance**: Three.js의 성능을 그대로 활용한다.
3. **DX**: 상태 관리, 훅, 이벤트 처리가 React 방식으로 통일된다.
4. **AI-Friendly**: 컴포넌트 구조가 명확하여 AI가 코드를 생성하기 쉽다.

## Three.js Rules
1. **R3F First**: React Three Fiber를 기본으로 사용한다.
2. **Latest Version**: Three.js r150 이상을 사용한다.
3. **Drei**: `@react-three/drei` 헬퍼 라이브러리를 활용한다.

## Setup
```bash
npm create vite@latest -- --template react-ts
npm install three @react-three/fiber @react-three/drei
npm install -D @types/three vitest
```
