// 기본 손 모양 팩 생성: node scripts/presets/handPoses.mjs → public/presets/handPoses.json
// curl은 손가락별 [1·2·3마디] 굽힘각(도). 최대치는 엄지 [45,60,55], 나머지 [85,95,65]
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const F = (c) => c;
const open = [0, 0, 0];
const fist4 = [85, 95, 65];

const POSES = [
  ['v', '브이(가위)', { Thumb: [30, 40, 20], Index: open, Middle: open, Ring: fist4, Pinky: fist4 }],
  ['ok', '오케이', { Thumb: [35, 45, 25], Index: [40, 50, 30], Middle: [4, 6, 3], Ring: [2, 4, 2], Pinky: [0, 2, 0] }],
  ['gun', '손가락 총', { Thumb: [0, 0, 0], Index: open, Middle: fist4, Ring: fist4, Pinky: fist4 }],
  ['stop', '손바닥 내밀기(정지)', { Thumb: [2, 3, 0], Index: [3, 3, 2], Middle: [3, 3, 2], Ring: [3, 3, 2], Pinky: [3, 4, 2] }],
  ['beckon', '손짓(부르기)', { Thumb: [10, 12, 5], Index: [60, 50, 30], Middle: [62, 52, 32], Ring: [64, 54, 34], Pinky: [66, 56, 36] }],
  ['two', '두 손가락 가리킴', { Thumb: [30, 40, 15], Index: open, Middle: open, Ring: fist4, Pinky: fist4 }],
  ['pen', '펜 쥐기', { Thumb: [25, 30, 10], Index: [45, 45, 30], Middle: [60, 60, 40], Ring: [70, 70, 50], Pinky: [75, 75, 50] }],
  ['cup', '컵 쥐기', { Thumb: [15, 25, 10], Index: [45, 55, 35], Middle: [50, 60, 40], Ring: [55, 65, 42], Pinky: [60, 70, 45] }],
  ['phone', '휴대폰 쥐기', { Thumb: [10, 10, 5], Index: [15, 20, 10], Middle: [35, 40, 25], Ring: [45, 50, 30], Pinky: [55, 55, 35] }],
  ['knob', '손잡이 쥐기(문)', { Thumb: [30, 40, 25], Index: [70, 85, 55], Middle: [72, 87, 56], Ring: [74, 89, 58], Pinky: [76, 91, 60] }],
  ['tense', '긴장(손가락 굽힘)', { Thumb: [15, 20, 10], Index: [25, 40, 20], Middle: [28, 42, 22], Ring: [30, 44, 24], Pinky: [32, 46, 26] }],
  ['soft-fist', '느슨한 주먹', { Thumb: [25, 30, 20], Index: [45, 55, 35], Middle: [50, 60, 38], Ring: [55, 65, 40], Pinky: [60, 70, 42] }],
  ['grip-hard', '꽉 쥐기(무기)', { Thumb: [40, 55, 45], Index: [75, 90, 60], Middle: [78, 92, 62], Ring: [80, 94, 64], Pinky: [82, 95, 65] }],
  ['pinch', '집기(핀치)', { Thumb: [30, 35, 20], Index: [35, 40, 25], Middle: [20, 25, 15], Ring: [22, 27, 17], Pinky: [24, 29, 19] }],
  ['receive', '받는 손(살짝 굽힘)', { Thumb: [8, 10, 5], Index: [12, 15, 8], Middle: [14, 17, 9], Ring: [16, 19, 10], Pinky: [18, 21, 11] }],
  ['claw', '움켜쥐기(갈고리)', { Thumb: [30, 35, 20], Index: [15, 80, 60], Middle: [15, 82, 62], Ring: [15, 84, 64], Pinky: [15, 86, 66] }],
  ['hush', '쉿(검지 세움)', { Thumb: [20, 30, 15], Index: open, Middle: fist4, Ring: fist4, Pinky: fist4 }],
  ['reach', '뻗기(손가락 살짝 벌림·굽힘)', { Thumb: [5, 8, 3], Index: [8, 10, 6], Middle: [9, 11, 6], Ring: [10, 12, 7], Pinky: [11, 13, 8] }],
];

const out = POSES.map(([id, name, curl]) => ({ id: `hand_${id}`, name, curl: F(curl) }));
const dir = join(dirname(fileURLToPath(import.meta.url)), '../../public/presets');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'handPoses.json'), JSON.stringify(out, null, 1));
console.log(`handPoses ${out.length}`);
