// 개발 페이지에서 돌리는 씬 생성기: SCENES 정의대로 컷을 꾸려 씬 JSON·썸네일을 뽑는다(작업 카드 안 컷에서 실행, 소품 탭을 한 번 열어 둘 것).
// 사용: const m = await import('/scripts/presets/sceneRunner.js?v=' + Date.now()); await m.run(window.__sceneDoll, {only?, post?: true})
import { SCENES } from './scenes.js';
import { lookAtAngles } from '/src/engine/ManuscriptControls.ts';
import { sceneFromCut } from '/src/model/library.ts';
import { analyzeCut } from '/src/describe/analyze.ts';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HEIGHT = { m: 175, f: 162 };
const DOLL = { m: 'mh2_m', f: 'mh2_f' };

export async function run(sd, opts = {}) {
  const e = sd.engine;
  const s = () => sd.store.getState();
  const poses = await (await fetch('/presets/poses/poses.json')).json();
  const grips = await (await fetch('/presets/props/grips.json')).json();
  const post = (path, body) => fetch('http://127.0.0.1:8899/?path=' + encodeURIComponent(path), { method: 'POST', body });
  const sheet = document.createElement('div');
  sheet.id = 'cmp';
  sheet.style.cssText = `position:fixed;inset:0;background:#fff;z-index:99999;display:grid;grid-template-columns:repeat(${opts.cols ?? 4},1fr);gap:2px;padding:2px;overflow:auto;font:11px sans-serif`;
  document.querySelectorAll('#cmp').forEach((n) => n.remove());
  document.body.appendChild(sheet);
  const out = [];
  const errs = [];

  for (const sc of SCENES) {
    if (opts.only && !opts.only.includes(sc.id)) continue;
    try {
      // 컷 비우기
      for (const d of [...s().currentCut().dolls]) s().removeDoll(d.id);
      for (const p of [...s().currentCut().props]) s().removeProp(p.id);
      await wait(150);
      const ids = [];
      for (const d of sc.dolls) {
        ids.push(s().addDoll(DOLL[d.g], HEIGHT[d.g], [d.at[0], 0, d.at[1]]));
      }
      await wait(900);
      const Q = e.dolls.get(ids[0]).root.quaternion.constructor;
      const V = e.dolls.get(ids[0]).root.position.constructor;
      sc.dolls.forEach((d, i) => {
        const rig = e.dolls.get(ids[i]);
        rig.root.position.set(d.at[0], 0, d.at[1]);
        rig.root.quaternion.copy(new Q().setFromAxisAngle(new V(0, 1, 0), (d.face * Math.PI) / 180));
        rig.root.updateMatrixWorld(true);
        const pose = poses.find((p) => p.id === d.pose);
        if (!pose) throw new Error('포즈 없음: ' + d.pose);
        e.applyPoseToDoll(ids[i], pose.joints, true);
        e.commitDoll(ids[i]);
      });
      if (sc.meet) {
        const [ia, ha, ib, hb] = sc.meet;
        const ra = e.dolls.get(ids[ia]);
        const rb = e.dolls.get(ids[ib]);
        ra.root.updateMatrixWorld(true);
        rb.root.updateMatrixWorld(true);
        const t = ra.worldPos(ha).clone().add(rb.worldPos(hb)).multiplyScalar(0.5);
        t.y = Math.min(t.y, 0.8);
        e.solveIk(ra, ha, t, { keepEndOrientation: false });
        e.solveIk(rb, hb, t, { keepEndOrientation: false });
        e.commitDoll(ids[ia]);
        e.commitDoll(ids[ib]);
      }
      for (const p of sc.props ?? []) {
        if (p.hold) {
          const iid = s().addProp(p.id);
          const g = grips[p.id]?.[p.hold.hand];
          s().attachProp(iid, ids[p.hold.doll], p.hold.hand, g ?? { position: [0, 0.07, 0], rotation: [0, 0, 0, 1] });
        } else {
          const iid = s().addProp(p.id, [p.at[0], 0, p.at[1]]);
          const q = new Q().setFromAxisAngle(new V(0, 1, 0), ((p.face ?? 0) * Math.PI) / 180);
          s().updateProp(iid, { rotation: [q.x, q.y, q.z, q.w] });
        }
      }
      const a = lookAtAngles(new V(...sc.cam.pos), new V(...sc.cam.look));
      s().commitCut((c) => {
        c.camera = { position: [...sc.cam.pos], yaw: a.yaw, pitch: a.pitch, roll: 0, focalLength: sc.cam.mm };
      });
      await wait(700);
      const cut = s().currentCut();
      const analysis = analyzeCut(e, cut, s().characters);
      const item = sceneFromCut(cut, analysis, { id: sc.id, name: sc.name, situationTags: sc.tags, now: '2026-01-01T00:00:00.000Z' });
      const cv = e.renderToCanvas(e.manu.camera, 384, 384 * cut.aspect, { background: 'white', showGrid: false });
      item.thumbnail = '';
      out.push(item);
      if (opts.post) {
        await post(`scenes/${sc.id}.json`, JSON.stringify(item));
        await post(`scenes/${sc.id}.png`, await new Promise((r) => cv.toBlob(r, 'image/png')));
      }
      const cell = document.createElement('div');
      const im = new Image();
      im.src = cv.toDataURL();
      im.style.cssText = 'width:100%;border:1px solid #ccc';
      cell.appendChild(im);
      const t = document.createElement('div');
      t.textContent = `${sc.name} · ${item.autoTags.count}명 ${item.autoTags.shot}/${item.autoTags.angle}`;
      cell.appendChild(t);
      sheet.appendChild(cell);
    } catch (err) {
      errs.push(sc.id + ': ' + err.message);
    }
  }
  if (opts.post) await post('scenes/scenes.json', JSON.stringify(out));
  return { n: out.length, errs };
}
