// 개발 페이지에서 돌리는 포즈 생성기: POSES 정의를 돌에 적용해 관절값·썸네일을 뽑는다.
// 사용: const m = await import('/scripts/presets/poseRunner.js?v=' + Date.now()); await m.run(window.__sceneDoll, {only?, post?: true})
import { POSES } from './poses.js';

const ALIAS = { soft: 'hand_soft-fist', phone: 'hand_phone', pen: 'hand_pen', tense: 'hand_tense', claw: 'hand_claw', cup: 'hand_cup' };

export async function run(sd, opts = {}) {
  const e = sd.engine;
  const st = sd.store.getState();
  const dollId = st.currentCut().dolls[0].id;
  const rig = e.dolls.get(dollId);
  const V = rig.worldPos('Hips').constructor;
  const Q = rig.jointDelta('Hips').constructor;
  const handPoses = await (await fetch('/presets/handPoses.json')).json();
  const rad = (d) => (d * Math.PI) / 180;
  const ax = (x, y, z, a) => new Q().setFromAxisAngle(new V(x, y, z), rad(a));

  const c = {
    reset() {
      rig.setJoints({});
      rig.root.position.set(0, 0, 0);
      rig.root.quaternion.set(0, 0, 0, 1);
      rig.root.updateMatrixWorld(true);
    },
    low(d) {
      rig.root.position.y = -d;
      rig.root.updateMatrixWorld(true);
    },
    /** 뼈를 dir 방향으로 향하게 한다(휴식 방향 → dir 최단 회전, 돌 공간 절대값) */
    aim(bone, dir) {
      const rest = rig.skel.rest.get(bone).dir;
      rig.setJointDelta(bone, new Q().setFromUnitVectors(rest.clone().normalize(), new V(dir[0], dir[1], dir[2]).normalize()));
      rig.root.updateMatrixWorld(true);
    },
    /** 손을 (out,y,z)에 두고, 팔꿈치는 pole([바깥, 위, 앞]) 쪽으로 굽힌다. 기본은 아래·약간 바깥·뒤 */
    hand(side, out, y, z, pole = [0.35, -1, -0.3]) {
      const sx = side === 'R' ? -1 : 1;
      const S0 = side === 'R' ? 'Right' : 'Left';
      const T = new V(sx * out, y, z);
      e.solveIk(rig, S0 + 'Hand', T, { keepEndOrientation: false });
      const sh = rig.worldPos(S0 + 'Arm');
      const el = rig.worldPos(S0 + 'ForeArm');
      const wr = rig.worldPos(S0 + 'Hand');
      const a = el.distanceTo(sh);
      const b = wr.distanceTo(el);
      const d = T.clone().sub(sh);
      const dist = Math.min(d.length(), a + b - 1e-3);
      const dir = d.clone().normalize();
      const x = (a * a - b * b + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, a * a - x * x));
      const pv = new V(sx * pole[0], pole[1], pole[2]);
      const perp = pv.clone().sub(dir.clone().multiplyScalar(pv.dot(dir)));
      if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0);
      perp.normalize();
      const E = sh.clone().addScaledVector(dir, x).addScaledVector(perp, h);
      const Tn = sh.clone().addScaledVector(dir, dist);
      c.aim(S0 + 'Arm', E.clone().sub(sh).toArray());
      c.aim(S0 + 'ForeArm', Tn.clone().sub(E).toArray());
    },
    foot(side, out, y, z, keep = true) {
      const sx = side === 'R' ? -1 : 1;
      e.solveIk(rig, side === 'R' ? 'RightFoot' : 'LeftFoot', new V(sx * out, y, z), { shoulder: false, keepEndOrientation: keep });
    },
    abs(bone, rx, ry, rz) {
      rig.setJointDelta(bone, ax(0, 0, 1, rz).multiply(ax(0, 1, 0, ry)).multiply(ax(1, 0, 0, rx)));
      rig.root.updateMatrixWorld(true);
    },
    bend(deg) {
      e.nudgeBodyPose(rig, { part: 'bend' }, deg);
    },
    hinge(deg) {
      e.nudgeHipHinge(rig, deg, null);
    },
    fingers(side, id) {
      const hand = side === 'R' ? 'right' : 'left';
      const alias = ALIAS[id];
      if (!alias && e.applyFingerPreset(hand, id, dollId)) return;
      const hp = handPoses.find((h) => h.id === (alias ?? id));
      if (hp) e.applyFingerCurl(hand, hp.curl, { dollId, commit: false });
    },
    ground() {
      rig.root.position.y -= rig.lowestPointY();
      rig.root.updateMatrixWorld(true);
    },
  };

  const post = (path, body) => fetch('http://127.0.0.1:8899/?path=' + encodeURIComponent(path), { method: 'POST', body });
  const out = [];
  const sheet = document.createElement('div');
  sheet.id = 'cmp';
  sheet.style.cssText = `position:fixed;inset:0;background:#fff;z-index:99999;display:grid;grid-template-columns:repeat(${opts.cols ?? 6},1fr);gap:2px;padding:2px;overflow:auto;font:11px sans-serif`;
  document.querySelectorAll('#cmp').forEach((n) => n.remove());
  document.body.appendChild(sheet);
  const errs = [];
  for (const p of POSES) {
    if (opts.only && !opts.only.includes(p.id) && !opts.only.includes(p.category)) continue;
    try {
      c.reset();
      p.build(c);
      c.ground();
      rig.root.updateMatrixWorld(true);
      const joints = rig.getJoints();
      const cv = e.renderDollSnapshot(dollId, opts.w ?? 200, opts.h ?? 260);
      out.push({ id: p.id, name: p.name, category: p.category, tags: p.tags, joints });
      if (opts.post) await post(`poses/${p.id}.png`, await new Promise((r) => cv.toBlob(r, 'image/png')));
      const cell = document.createElement('div');
      const im = new Image();
      im.src = cv.toDataURL();
      im.style.cssText = 'width:100%;border:1px solid #ccc';
      cell.appendChild(im);
      const t = document.createElement('div');
      t.textContent = p.name;
      cell.appendChild(t);
      sheet.appendChild(cell);
    } catch (err) {
      errs.push(p.id + ': ' + err.message);
    }
  }
  c.reset();
  if (opts.post) await post('poses/poses.json', JSON.stringify(out));
  return { n: out.length, errs };
}
