// 앱 아이콘(build/icon.png, 256x256): 파란 바탕에 흰 돌(마네킹) 실루엣. 의존성 없이 PNG를 직접 쓴다.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const N = 256;
const px = Buffer.alloc(N * N * 4);
const inRound = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), N - 1 - r);
  const cy = Math.min(Math.max(y, r), N - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    if (!inRound(x, y, 48)) continue; // 투명
    let c = [47, 111, 235];
    const head = ell(x, y, 128, 78, 30, 34);
    const torso = ell(x, y, 128, 150, 44, 52);
    const armL = ell(x, y, 80, 150, 12, 46);
    const armR = ell(x, y, 176, 150, 12, 46);
    const legL = ell(x, y, 108, 214, 14, 36);
    const legR = ell(x, y, 148, 214, 14, 36);
    if (head || torso || armL || armR || legL || legR) c = [255, 255, 255];
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  }
}
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const cr = Buffer.alloc(4);
  cr.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
