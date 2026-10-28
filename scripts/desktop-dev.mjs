// 개발 실행: vite 개발 서버(5173)를 띄우고 Electron이 그 주소를 연다. 창을 닫으면 둘 다 끝난다.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const sh = process.platform === 'win32';

await new Promise((resolve, reject) => {
  const b = spawn('node', ['scripts/build-electron.mjs'], { stdio: 'inherit' });
  b.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('electron 빌드 실패'))));
});
const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'inherit', shell: sh });
const waitFor = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch('http://localhost:5173/');
      if (r.ok) return;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('vite가 뜨지 않았습니다');
};
await waitFor();
const el = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, SCENEDOLL_DEV_URL: 'http://localhost:5173/' } });
el.on('exit', () => {
  vite.kill();
  process.exit(0);
});
