// 기본 팩 매니페스트 생성: public/presets 아래의 props.json(+grips.json), poses.json, handPoses.json을 합쳐 manifest.json을 만든다.
// 실행: node scripts/presets/buildManifest.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../public/presets');
const read = (rel, fallback) => (existsSync(join(root, rel)) ? JSON.parse(readFileSync(join(root, rel), 'utf8')) : fallback);

const props = read('props/props.json', []);
const grips = read('props/grips.json', {});
const poses = read('poses/poses.json', []);
const handPoses = read('handPoses.json', []);

const manifest = {
  version: 1,
  props: props.map((p) => ({ id: p.id, name: p.name, tags: p.tags, grip: grips[p.id] ?? {}, thumb: existsSync(join(root, `props/${p.id}.png`)) })),
  poses: poses.map((p) => ({ ...p, thumb: existsSync(join(root, `poses/${p.id}.png`)) })),
  handPoses,
};
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
console.log(`props ${manifest.props.length} · poses ${manifest.poses.length} · handPoses ${manifest.handPoses.length}`);
