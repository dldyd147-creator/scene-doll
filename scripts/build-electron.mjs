// 메인·preload를 한 파일씩 묶는다(electron-dist/). 화면은 vite build가 dist/에 만든다.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: false, logLevel: 'info' };
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'electron-dist/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'electron-dist/preload.cjs' });
