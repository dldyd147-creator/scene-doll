import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 브라우저 단독 정적 페이지. base를 상대 경로로 두어 GitHub Pages 등 어떤 경로에 올려도 동작한다.
// 데스크톱 설치판(--mode desktop)은 멈춤 기록의 호출 줄을 원래 코드 줄로 되돌릴 수 있게 소스맵을 함께 만든다(웹 배포에는 넣지 않는다)
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: mode === 'desktop', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'electron/**/*.test.ts'] },
}));
