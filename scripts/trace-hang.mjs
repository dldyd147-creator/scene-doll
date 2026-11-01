// 멈춤 기록(diagnostics.log)의 'index-XXXX.js:줄:열' 호출 줄을 원래 소스 줄로 바꿔 보여 준다.
// 사용: node scripts/trace-hang.mjs <diagnostics.log 경로> [dist 폴더(기본 dist)]
// 기록을 남긴 설치판과 같은 빌드(--mode desktop)의 dist/assets/*.map 이 있어야 한다
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const [logPath, distDir = 'dist'] = process.argv.slice(2);
if (!logPath) {
  console.error('사용: node scripts/trace-hang.mjs <diagnostics.log> [dist]');
  process.exit(1);
}
const assets = path.join(distDir, 'assets');
const maps = new Map();
for (const f of existsSync(assets) ? readdirSync(assets) : []) {
  if (f.endsWith('.js.map')) maps.set(f.slice(0, -4), new TraceMap(readFileSync(path.join(assets, f), 'utf8')));
}
if (!maps.size) console.error(`소스맵이 없습니다: ${assets}/*.js.map (vite build --mode desktop 으로 만든 dist가 필요)`);

for (const line of readFileSync(logPath, 'utf8').split(/\r?\n/)) {
  const m = /^(\s+)(\S.*?)\s{2}(\S+\.js):(\d+):(\d+)$/.exec(line);
  const tm = m && maps.get(m[3]);
  if (!m || !tm) {
    console.log(line);
    continue;
  }
  const o = originalPositionFor(tm, { line: Number(m[4]), column: Number(m[5]) - 1 });
  console.log(`${m[1]}${o.name ?? m[2]}  ${o.source ? o.source.replace(/^.*\/src\//, 'src/') : m[3]}:${o.line ?? '?'}:${(o.column ?? 0) + 1}`);
}
