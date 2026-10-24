import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 브라우저 단독 정적 페이지. base를 상대 경로로 두어 GitHub Pages 등 어떤 경로에 올려도 동작한다.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
