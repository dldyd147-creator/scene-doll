// 기본 소품 팩 생성기: 간단한 도형을 합쳐 GLB로 내보낸다(참고용이라 디테일은 낮게).
// 실행: node scripts/presets/propBuilder.mjs  → public/presets/props/*.glb + props.json(메타)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, TorusGeometry, ExtrudeGeometry, Shape, Mesh, MeshStandardMaterial, Group, Scene } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(b) {
    b.arrayBuffer().then((ab) => {
      this.result = ab;
      this.onloadend && this.onloadend();
    });
  }
  readAsDataURL(b) {
    b.arrayBuffer().then((ab) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(ab).toString('base64');
      this.onloadend && this.onloadend();
    });
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../public/presets/props');
mkdirSync(outDir, { recursive: true });

const MET = '#c0c7d1';
const DARK = '#3a3d45';
const WOOD = '#b08968';
const LEATHER = '#6b4a35';
const GOLD = '#d4a017';
const GRAY = '#8a8f98';
const LIGHT = '#d9d9d9';
const WHITE = '#f1f1f1';
const RED = '#a8423a';
const BLUE = '#3f6fb5';
const GREEN = '#4f7a4a';

const mat = (c) => new MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0 });

/** 파트 도우미 */
function part(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], name = 'part') {
  const m = new Mesh(geo, mat(color));
  m.name = name;
  m.position.set(...pos);
  m.rotation.set(...rot);
  return m;
}
const box = (w, h, d, c, pos, rot) => part(new BoxGeometry(w, h, d), c, pos, rot, 'box');
const cyl = (rt, rb, h, c, pos, rot, seg = 16) => part(new CylinderGeometry(rt, rb, h, seg), c, pos, rot, 'cyl');
const cone = (r, h, c, pos, rot) => part(new ConeGeometry(r, h, 16), c, pos, rot, 'cone');
const sph = (r, c, pos) => part(new SphereGeometry(r, 16, 12), c, pos, [0, 0, 0], 'sph');
const tor = (r, t, c, pos, rot, arc = Math.PI * 2) => part(new TorusGeometry(r, t, 8, 24, arc), c, pos, rot, 'tor');
/** 2D 윤곽을 두께(z)만큼 밀어낸 판. pts는 [x,y] 목록(닫힘) */
function plate(pts, depth, c, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const s = new Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return part(g, c, pos, rot, 'plate');
}

/** 칼날: y0에서 y0+len까지, 폭 w. curve는 끝으로 갈수록 휘는 양(곡도) */
function blade(len, w, c, { curve = 0, tip = 0.12, t = 0.008, y0 = 0 } = {}) {
  const pts = [];
  const n = 8;
  const bodyLen = len * (1 - tip);
  for (let i = 0; i <= n; i++) {
    const y = y0 + (bodyLen * i) / n;
    pts.push([-w / 2 + curve * Math.pow((y - y0) / len, 2), y]);
  }
  pts.push([curve, y0 + len]);
  for (let i = n; i >= 0; i--) {
    const y = y0 + (bodyLen * i) / n;
    pts.push([w / 2 + curve * Math.pow((y - y0) / len, 2), y]);
  }
  return plate(pts, t, c);
}

function group(...children) {
  const g = new Group();
  for (const c of children.flat()) if (c) g.add(c);
  return g;
}

/**
 * 소품 정의. kind: 'rod'(손에 쥐는 막대형, Y=길이) / 'gun'(Y=손잡이 위, Z=총구) / 'flat'(Y=길이, Z=화면·앞면 법선) / 'none'(쥐지 않음)
 * 원점은 쥐는 곳(막대·총·납작한 것)이거나 바닥 중앙(가구)이다
 */
export const PROPS = [];
const add = (id, name, tags, kind, build) => PROPS.push({ id, name, tags, kind, build });

// ---------- 무기 ----------
function sword({ handle = 0.14, bladeLen = 0.8, w = 0.05, guard = 0.14, curve = 0, pommel = true, t = 0.008, tip = 0.1, guardType = 'cross', handleColor = LEATHER } = {}) {
  const parts = [cyl(0.014, 0.014, handle, handleColor, [0, 0, 0])];
  if (pommel) parts.push(sph(0.02, GOLD, [0, -handle / 2 - 0.005, 0]));
  if (guardType === 'cross') parts.push(box(guard, 0.02, 0.025, GOLD, [0, handle / 2 + 0.01, 0]));
  if (guardType === 'disc') parts.push(cyl(guard / 2, guard / 2, 0.012, DARK, [0, handle / 2 + 0.006, 0], [0, 0, 0], 20));
  parts.push(blade(bladeLen, w, MET, { curve, tip, t, y0: handle / 2 + 0.02 }));
  return group(parts);
}
add('sword1', '한손검', ['무기', '검'], 'rod', () => sword({ bladeLen: 0.78, w: 0.05, guard: 0.14 }));
add('sword2', '양손검', ['무기', '검'], 'rod', () => sword({ handle: 0.3, bladeLen: 1.1, w: 0.065, guard: 0.22 }));
add('katana', '직도', ['무기', '검'], 'rod', () => sword({ handle: 0.24, bladeLen: 0.72, w: 0.032, guard: 0.07, guardType: 'disc', t: 0.007, tip: 0.07, pommel: false, handleColor: DARK }));
add('saber', '곡도', ['무기', '검'], 'rod', () => sword({ handle: 0.13, bladeLen: 0.75, w: 0.045, curve: 0.11, guard: 0.1, tip: 0.1 }));
add('tanto', '단도', ['무기', '칼'], 'rod', () => sword({ handle: 0.13, bladeLen: 0.26, w: 0.028, guard: 0.05, guardType: 'disc', tip: 0.1, pommel: false, handleColor: DARK }));
add('dagger', '단검', ['무기', '칼'], 'rod', () => sword({ handle: 0.1, bladeLen: 0.22, w: 0.034, guard: 0.07, tip: 0.18, t: 0.006 }));
add('spear', '창', ['무기', '장병기'], 'rod', () =>
  group(cyl(0.012, 0.012, 1.7, WOOD, [0, 0.2, 0]), plate([[-0.025, 0], [0.025, 0], [0, 0.22]], 0.01, MET, [0, 1.05, 0]), cyl(0.016, 0.016, 0.03, DARK, [0, 1.04, 0])));
add('axe', '도끼', ['무기', '장병기'], 'rod', () =>
  group(cyl(0.017, 0.017, 0.8, WOOD, [0, 0.2, 0]), plate([[0, 0.5], [0.16, 0.62], [0.16, 0.38], [0, 0.46]], 0.012, MET)));
add('hammer', '전투 망치', ['무기', '장병기'], 'rod', () => group(cyl(0.018, 0.018, 0.7, WOOD, [0, 0.15, 0]), box(0.18, 0.1, 0.1, DARK, [0, 0.55, 0])));
add('bat', '곤봉(방망이)', ['무기', '도구'], 'rod', () => group(cyl(0.035, 0.012, 0.85, WOOD, [0, 0.3, 0]), cyl(0.016, 0.016, 0.02, DARK, [0, -0.1, 0])));
add('shield', '방패', ['무기', '방어'], 'none', () =>
  group(cyl(0.3, 0.3, 0.03, BLUE, [0, 0, 0], [Math.PI / 2, 0, 0], 24), cyl(0.06, 0.06, 0.05, MET, [0, 0, 0.015], [Math.PI / 2, 0, 0])));
add('bow', '활', ['무기', '원거리'], 'rod', () =>
  group(tor(0.6, 0.012, WOOD, [-0.5, 0, 0], [0, 0, -Math.PI * 0.28], Math.PI * 0.56), cyl(0.002, 0.002, 1.04, GRAY, [-0.08, 0, 0])));

// 총: 원점=손잡이 중앙, +Y=손잡이 위쪽, +Z=총구 방향
add('pistol', '권총', ['무기', '총'], 'gun', () =>
  group(
    box(0.03, 0.12, 0.05, DARK, [0, 0, -0.005], [-0.2, 0, 0]),
    box(0.034, 0.045, 0.2, DARK, [0, 0.08, 0.04]),
    box(0.012, 0.03, 0.03, DARK, [0, 0.04, 0.03]),
    cyl(0.008, 0.008, 0.05, MET, [0, 0.085, 0.165], [Math.PI / 2, 0, 0]),
  ));
add('rifle', '소총', ['무기', '총'], 'gun', () =>
  group(
    box(0.04, 0.12, 0.06, DARK, [0, 0, 0], [-0.25, 0, 0]),
    box(0.05, 0.08, 0.5, DARK, [0, 0.09, 0.12]),
    cyl(0.012, 0.012, 0.35, MET, [0, 0.105, 0.5], [Math.PI / 2, 0, 0]),
    box(0.04, 0.09, 0.3, LEATHER, [0, 0.07, -0.28], [0.1, 0, 0]),
    box(0.03, 0.18, 0.05, DARK, [0, -0.02, 0.18], [0.12, 0, 0]),
    box(0.02, 0.025, 0.1, DARK, [0, 0.16, 0.1]),
  ));
add('shotgun', '산탄총', ['무기', '총'], 'gun', () =>
  group(
    box(0.04, 0.12, 0.06, WOOD, [0, 0, 0], [-0.25, 0, 0]),
    box(0.05, 0.07, 0.3, DARK, [0, 0.09, 0.08]),
    cyl(0.018, 0.018, 0.55, MET, [0, 0.105, 0.5], [Math.PI / 2, 0, 0]),
    box(0.05, 0.05, 0.25, WOOD, [0, 0.07, 0.35]),
    box(0.04, 0.09, 0.3, WOOD, [0, 0.07, -0.28], [0.1, 0, 0]),
  ));
add('bazooka', '바주카', ['무기', '총', '중화기'], 'gun', () =>
  group(
    cyl(0.055, 0.055, 1.1, GREEN, [0, 0.14, 0.2], [Math.PI / 2, 0, 0], 20),
    cyl(0.07, 0.055, 0.12, DARK, [0, 0.14, 0.8], [Math.PI / 2, 0, 0], 20),
    cyl(0.075, 0.06, 0.1, DARK, [0, 0.14, -0.35], [Math.PI / 2, 0, 0], 20),
    box(0.035, 0.12, 0.05, DARK, [0, 0.04, 0], [-0.1, 0, 0]),
    box(0.035, 0.1, 0.04, DARK, [0, 0.04, 0.3]),
    box(0.03, 0.05, 0.12, GRAY, [0, 0.22, 0.1]),
    cone(0.05, 0.12, RED, [0, 0.14, 0.92], [Math.PI / 2, 0, 0]),
  ));

// ---------- 생활 ----------
add('phone', '스마트폰', ['생활', '전자기기'], 'flat', () =>
  group(box(0.07, 0.15, 0.008, DARK, [0, 0, 0]), box(0.062, 0.135, 0.002, '#1f2b3d', [0, 0, 0.0045]), cyl(0.008, 0.008, 0.002, '#101010', [0.02, 0.06, -0.0045], [Math.PI / 2, 0, 0])));
add('mug', '머그컵', ['생활', '컵'], 'rod', () =>
  group(cyl(0.04, 0.036, 0.095, WHITE, [0, 0, 0]), tor(0.026, 0.007, WHITE, [0.042, 0, 0], [0, 0, -Math.PI / 2], Math.PI)));
add('papercup', '종이컵', ['생활', '컵'], 'rod', () => group(cyl(0.04, 0.03, 0.11, LIGHT, [0, 0, 0]), cyl(0.032, 0.032, 0.016, GRAY, [0, 0.06, 0]), cyl(0.04, 0.04, 0.03, RED, [0, 0, 0])));
add('glass', '유리잔', ['생활', '컵'], 'rod', () => group(cyl(0.032, 0.026, 0.12, '#cfe6f2', [0, 0, 0])));
add('bottle', '병', ['생활', '컵'], 'rod', () => group(cyl(0.04, 0.04, 0.2, GREEN, [0, 0, 0]), cyl(0.014, 0.04, 0.06, GREEN, [0, 0.13, 0]), cyl(0.014, 0.014, 0.08, GREEN, [0, 0.2, 0]), cyl(0.017, 0.017, 0.02, GOLD, [0, 0.245, 0])));
add('book', '책', ['생활'], 'flat', () => group(box(0.15, 0.21, 0.03, BLUE, [0, 0, 0]), box(0.14, 0.2, 0.026, WHITE, [0.003, 0, 0]), box(0.004, 0.21, 0.032, DARK, [-0.074, 0, 0])));
add('laptop', '노트북', ['생활', '전자기기'], 'none', () =>
  group(box(0.32, 0.015, 0.22, GRAY, [0, 0.0075, 0]), box(0.32, 0.22, 0.012, GRAY, [0, 0.12, -0.105], [-0.25, 0, 0]), box(0.29, 0.19, 0.003, '#1f2b3d', [0, 0.12, -0.098], [-0.25, 0, 0])));
add('glasses', '안경', ['생활'], 'flat', () =>
  group(tor(0.025, 0.0025, DARK, [-0.035, 0, 0]), tor(0.025, 0.0025, DARK, [0.035, 0, 0]), box(0.02, 0.003, 0.003, DARK, [0, 0.01, 0]), box(0.003, 0.003, 0.13, DARK, [-0.06, 0.01, -0.065]), box(0.003, 0.003, 0.13, DARK, [0.06, 0.01, -0.065])));
add('umbrella', '우산', ['생활'], 'rod', () =>
  group(cyl(0.006, 0.006, 0.85, DARK, [0, 0.25, 0]), cone(0.45, 0.2, RED, [0, 0.8, 0]), tor(0.025, 0.006, DARK, [0, -0.2, 0], [0, 0, 0], Math.PI)));
add('pen', '펜', ['생활'], 'rod', () => group(cyl(0.006, 0.006, 0.14, DARK, [0, 0, 0]), cone(0.006, 0.02, MET, [0, -0.08, 0], [Math.PI, 0, 0])));
add('bag', '서류가방', ['생활', '가방'], 'rod', () => group(box(0.4, 0.3, 0.1, LEATHER, [0, -0.2, 0]), tor(0.06, 0.008, DARK, [0, -0.04, 0], [0, 0, 0], Math.PI)));
add('backpack', '백팩', ['생활', '가방'], 'none', () => group(box(0.3, 0.42, 0.16, GREEN, [0, 0.21, 0]), box(0.24, 0.16, 0.05, DARK, [0, 0.12, 0.1])));
add('cane', '지팡이', ['생활', '도구'], 'rod', () => group(cyl(0.012, 0.012, 0.9, WOOD, [0, -0.3, 0]), tor(0.05, 0.012, WOOD, [0.05, 0.17, 0], [0, 0, 0], Math.PI)));

// ---------- 가구·배경 (원점=바닥 중앙, +Y=위, 앞=+Z) ----------
const legs = (x, z, h, w, c) => [[-x, -z], [x, -z], [-x, z], [x, z]].map(([px, pz]) => box(w, h, w, c, [px, h / 2, pz]));
add('chair', '의자', ['가구', '앉기'], 'none', () => group(box(0.42, 0.04, 0.42, WOOD, [0, 0.44, 0]), box(0.42, 0.42, 0.03, WOOD, [0, 0.67, -0.195]), legs(0.19, 0.19, 0.44, 0.035, DARK)));
add('stool', '스툴', ['가구', '앉기'], 'none', () => group(cyl(0.18, 0.18, 0.04, WOOD, [0, 0.44, 0]), legs(0.12, 0.12, 0.44, 0.035, DARK)));
add('desk', '책상', ['가구'], 'none', () => group(box(1.2, 0.04, 0.6, WOOD, [0, 0.74, 0]), legs(0.55, 0.26, 0.72, 0.04, DARK)));
add('table', '식탁', ['가구'], 'none', () => group(box(1.5, 0.05, 0.8, WOOD, [0, 0.72, 0]), legs(0.68, 0.34, 0.7, 0.06, DARK)));
add('bed', '침대', ['가구', '눕기'], 'none', () =>
  group(box(1.0, 0.25, 2.0, DARK, [0, 0.125, 0]), box(0.96, 0.2, 1.9, WHITE, [0, 0.35, 0.02]), box(0.9, 0.12, 0.35, LIGHT, [0, 0.52, -0.75]), box(1.0, 0.55, 0.06, WOOD, [0, 0.5, -1.0])));
add('sofa', '소파', ['가구', '앉기'], 'none', () =>
  group(box(1.8, 0.3, 0.85, GRAY, [0, 0.25, 0]), box(1.8, 0.45, 0.2, GRAY, [0, 0.6, -0.33]), box(0.2, 0.3, 0.85, GRAY, [-0.9, 0.5, 0]), box(0.2, 0.3, 0.85, GRAY, [0.9, 0.5, 0]), box(1.4, 0.14, 0.7, '#7a7f88', [0, 0.47, 0.08])));
add('bench', '벤치', ['가구', '앉기'], 'none', () =>
  group(box(1.5, 0.05, 0.4, WOOD, [0, 0.44, 0]), box(1.5, 0.35, 0.04, WOOD, [0, 0.7, -0.18], [-0.1, 0, 0]), ...[-0.65, 0.65].map((x) => box(0.05, 0.44, 0.38, DARK, [x, 0.22, 0]))));
add('door', '문', ['가구', '배경'], 'none', () =>
  group(box(0.9, 2.0, 0.04, WOOD, [0, 1.0, 0]), box(0.05, 2.05, 0.1, DARK, [-0.475, 1.025, 0]), box(0.05, 2.05, 0.1, DARK, [0.475, 1.025, 0]), box(1.0, 0.05, 0.1, DARK, [0, 2.025, 0]), sph(0.03, GOLD, [0.35, 1.0, 0.04])));
add('stairs', '계단', ['가구', '배경'], 'none', () => group(...[0, 1, 2, 3, 4].map((i) => box(1.0, 0.18, 0.28, GRAY, [0, 0.09 + 0.18 * i, -0.28 * i]))));
add('bicycle', '자전거', ['탈것'], 'none', () =>
  group(
    tor(0.34, 0.015, DARK, [0, 0.34, 0.55], [0, Math.PI / 2, 0]),
    tor(0.34, 0.015, DARK, [0, 0.34, -0.55], [0, Math.PI / 2, 0]),
    cyl(0.012, 0.012, 1.1, RED, [0, 0.55, 0], [Math.PI / 2, 0, 0]),
    cyl(0.012, 0.012, 0.45, RED, [0, 0.55, -0.2], [0.8, 0, 0]),
    cyl(0.012, 0.012, 0.4, DARK, [0, 0.85, 0.45]),
    box(0.4, 0.015, 0.015, DARK, [0, 1.0, 0.5]),
    box(0.1, 0.03, 0.2, DARK, [0, 0.82, -0.28]),
  ));

const exporter = new GLTFExporter();
for (const p of PROPS) {
  const scene = new Scene();
  scene.add(p.build());
  const ab = await exporter.parseAsync(scene, { binary: true });
  writeFileSync(join(outDir, `${p.id}.glb`), Buffer.from(ab));
}
writeFileSync(join(outDir, 'props.json'), JSON.stringify(PROPS.map(({ id, name, tags, kind }) => ({ id, name, tags, kind })), null, 2));
console.log(`${PROPS.length} props → ${outDir}`);
