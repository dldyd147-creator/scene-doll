import { Bone, BufferAttribute, type BufferGeometry, Group, Matrix4, Object3D, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { fingerBoneName } from '../model/fingers';

/**
 * Universal Human의 Body Rig(블렌더에서 GLB로 내보낸 것)를 표준(Mixamo) 이름의 단순 뼈대로 바꾼다.
 * 내보낸 파일에는 컨트롤러·보조 뼈·주석 글자까지 들어 있고(뼈 300여 개), 팔은 쇄골이 아니라 별도 부모에 달려 있다(구속조건이 빠져서).
 * 그래서 변형에 쓰이는 뼈만 골라 새 계층을 만들고, 나머지 뼈의 스킨 가중치는 가장 가까운 선택 뼈에 합친다.
 */

const sanitize = (n: string) => n.replace(/\s/g, '_').replace(/[[\].:/]/g, '');

interface Spec {
  std: string;
  /** 원본 뼈 이름(블렌더 이름). 합성 뼈는 null */
  src: string | null;
  parent: string | null;
}

function specs(): Spec[] {
  const out: Spec[] = [
    { std: 'Hips', src: 'Pelvis Bone', parent: null },
    { std: 'Spine', src: 'Spine 1', parent: 'Hips' },
    { std: 'Spine1', src: 'Spine 2', parent: 'Spine' },
    { std: 'Spine2', src: 'Spine 4', parent: 'Spine1' },
    { std: 'Neck', src: 'Neck 1', parent: 'Spine2' },
    { std: 'Head', src: 'Head Bone', parent: 'Neck' },
    { std: 'HeadTop_End', src: null, parent: 'Head' },
  ];
  for (const [x, side] of [['L', 'Left'], ['R', 'Right']] as const) {
    out.push(
      { std: `${side}Shoulder`, src: `Clavicle.${x}`, parent: 'Spine2' },
      { std: `${side}Arm`, src: `Upper Arm.${x}`, parent: `${side}Shoulder` },
      { std: `${side}ForeArm`, src: `Forearm.${x}`, parent: `${side}Arm` },
      { std: `${side}Hand`, src: `Wrist.${x}`, parent: `${side}ForeArm` },
    );
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky'] as const) {
      for (const j of [1, 2, 3] as const) {
        out.push({ std: fingerBoneName(side, f, j), src: `Finger ${f} ${j}.${x}`, parent: j === 1 ? `${side}Hand` : fingerBoneName(side, f, (j - 1) as 1 | 2) });
      }
    }
    const thumb = [`Metacarpal Thumb.${x}`, `Thumb 1.${x}`, `Thumb 2.${x}`];
    thumb.forEach((src, i) => out.push({ std: fingerBoneName(side, 'Thumb', (i + 1) as 1 | 2 | 3), src, parent: i === 0 ? `${side}Hand` : fingerBoneName(side, 'Thumb', i as 1 | 2) }));
    out.push(
      { std: `${side}UpLeg`, src: `Thigh.${x}`, parent: 'Hips' },
      { std: `${side}Leg`, src: `Shin.${x}`, parent: `${side}UpLeg` },
      { std: `${side}Foot`, src: `Ankle.${x}`, parent: `${side}Leg` },
      { std: `${side}ToeBase`, src: `Toe Bone.${x}`, parent: `${side}Foot` },
      { std: `${side}Toe_End`, src: null, parent: `${side}ToeBase` },
    );
  }
  return out;
}

/** 계층상 조상으로는 찾을 수 없는 보조 뼈의 합칠 곳(정리한 뼈 이름 기준) */
const OVERRIDES: Record<string, string> = {};
for (const [x, side] of [['L', 'Left'], ['R', 'Right']] as const) {
  OVERRIDES[sanitize(`Thigh Upper.${x}`)] = `${side}UpLeg`;
  OVERRIDES[sanitize(`Shoulder Deform.${x}`)] = `${side}Shoulder`;
}

/** 이 GLB가 Human Rig 내보내기인지(뼈 이름으로 판별) */
export function isHumanRigScene(scene: Object3D): boolean {
  let found = false;
  scene.traverse((o) => {
    if ((o as Bone).isBone && o.name === 'Pelvis_Bone') found = true;
  });
  return found;
}

export function adaptHumanRig(src: Object3D): Group {
  src.updateMatrixWorld(true);
  const oldBones = new Map<string, Bone>();
  src.traverse((o) => {
    if ((o as Bone).isBone) oldBones.set(o.name, o as Bone);
  });
  const list = specs();
  const bySrc = new Map<string, Spec>();
  for (const s of list) if (s.src) bySrc.set(sanitize(s.src), s);

  // 새 뼈: 월드 행렬은 원본에서 가져오고, 부모는 표준 계층으로 다시 정한다
  const world = new Map<string, Matrix4>();
  const newBones = new Map<string, Bone>();
  let topY = 1.7;
  src.traverse((o) => {
    const m = o as { isSkinnedMesh?: boolean; geometry?: BufferGeometry };
    if (m.isSkinnedMesh && m.geometry) {
      m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) topY = Math.max(topY, m.geometry.boundingBox.max.y);
    }
  });
  for (const s of list) {
    let w: Matrix4;
    if (s.src) {
      const ob = oldBones.get(sanitize(s.src));
      if (!ob) throw new Error(`Human Rig 뼈를 찾지 못했습니다: ${s.src}`);
      w = ob.matrixWorld.clone();
    } else if (s.std === 'HeadTop_End') {
      const h = new Vector3().setFromMatrixPosition(world.get('Head')!);
      w = new Matrix4().makeTranslation(h.x, Math.max(topY, h.y + 0.15), h.z);
    } else {
      const toe = new Vector3().setFromMatrixPosition(world.get(s.parent!)!);
      const ankle = new Vector3().setFromMatrixPosition(world.get(s.parent!.replace('ToeBase', 'Foot'))!);
      const fwd = toe.clone().sub(ankle).setY(0);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
      toe.addScaledVector(fwd.normalize(), 0.08);
      w = new Matrix4().makeTranslation(toe.x, toe.y, toe.z);
    }
    world.set(s.std, w);
    const bone = new Bone();
    bone.name = s.std;
    const pw = s.parent ? world.get(s.parent)! : new Matrix4();
    const local = pw.clone().invert().multiply(w);
    const q = new Quaternion();
    local.decompose(bone.position, q, new Vector3());
    bone.quaternion.copy(q);
    newBones.set(s.std, bone);
    if (s.parent) newBones.get(s.parent)!.add(bone);
  }

  // 원본 뼈 → 합쳐질 새 뼈 이름(가장 가까운 선택 뼈 조상)
  const ownerOf = new Map<string, string>();
  const resolve = (b: Bone): string => {
    const hit = ownerOf.get(b.name);
    if (hit) return hit;
    let res: string | null = bySrc.get(b.name)?.std ?? null;
    if (!res) res = OVERRIDES[b.name] ?? null;
    if (!res) {
      const p = b.parent as Bone | null;
      res = p && (p as Bone).isBone ? resolve(p) : 'Hips';
    }
    ownerOf.set(b.name, res);
    return res;
  };

  const group = new Group();
  group.name = 'HumanRig';
  group.add(newBones.get('Hips')!);
  const order = list.map((s) => s.std);
  const skeleton = new Skeleton(
    order.map((n) => newBones.get(n)!),
    order.map((n) => world.get(n)!.clone().invert()),
  );
  const newIndex = new Map(order.map((n, i) => [n, i]));

  src.traverse((o) => {
    const sm = o as SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const g = sm.geometry.clone();
    g.morphAttributes = {};
    g.morphTargetsRelative = false;
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    const map = sm.skeleton.bones.map((b) => newIndex.get(resolve(b)) ?? 0);
    const outI = new Uint16Array(si.count * 4);
    const outW = new Float32Array(si.count * 4);
    for (let v = 0; v < si.count; v++) {
      const acc = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(v, k);
        if (w <= 0) continue;
        const ni = map[si.getComponent(v, k)];
        acc.set(ni, (acc.get(ni) ?? 0) + w);
      }
      const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((t, e) => t + e[1], 0) || 1;
      top.forEach(([ni, w], k) => {
        outI[v * 4 + k] = ni;
        outW[v * 4 + k] = w / sum;
      });
    }
    g.setAttribute('skinIndex', new BufferAttribute(outI, 4));
    g.setAttribute('skinWeight', new BufferAttribute(outW, 4));
    const mesh = new SkinnedMesh(g, sm.material as SkinnedMesh['material']);
    mesh.name = sm.name;
    sm.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    group.add(mesh);
    group.updateMatrixWorld(true);
    mesh.bind(skeleton, mesh.matrixWorld.clone());
  });
  group.updateMatrixWorld(true);
  return group;
}
