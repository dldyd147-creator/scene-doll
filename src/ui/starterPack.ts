import type { Pose, PropAsset } from '../model/types';
import { normalizeHandPose, type HandPose } from '../model/fingers';
import { normalizePose } from '../model/library';
import { storage } from '../storage';

/**
 * 기본 프리셋 팩(소품·포즈·손 모양): 앱에 들어 있는 파일(public/presets)을 이 저장소의 공용 폴더로 한 번 복사한다.
 * 복사한 것은 사용자가 만든 것과 같아서 고치거나 지울 수 있다. 설치한 id를 저장소에 기록해 두므로, 지운 것이 다시 살아나지 않고
 * 팩에 새 항목이 생기면 그것만 더해진다. '다시 설치'는 기록을 무시하고 전부 덮어쓴다.
 */

interface ManifestProp {
  id: string;
  name: string;
  tags: string[];
  grip: PropAsset['grip'];
  thumb: boolean;
}
interface ManifestPose extends Omit<Pose, 'thumbnail'> {
  thumb: boolean;
}
interface Manifest {
  version: number;
  props: ManifestProp[];
  poses: ManifestPose[];
  handPoses: Array<Partial<HandPose>>;
}

const base = (): string => import.meta.env.BASE_URL;

async function fetchBuffer(rel: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${base()}presets/${rel}`);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function bufferToDataUrl(buf: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}

/** 설치할 항목이 있으면 설치한다. 설치한(또는 건너뛴) 개수를 돌려준다 */
export async function installStarterPack(force = false): Promise<{ props: number; poses: number; handPoses: number }> {
  const done = { props: 0, poses: 0, handPoses: 0 };
  const buf = await fetchBuffer('manifest.json');
  if (!buf) return done;
  const manifest = JSON.parse(new TextDecoder().decode(buf)) as Manifest;
  const repo = storage.repository;
  const state = force ? { installed: [] as string[] } : (await repo.readStarterPackState()) ?? { installed: [] as string[] };
  const installed = new Set(state.installed);
  const stamp = Date.parse('2026-01-01T00:00:00Z');

  for (const [i, p] of manifest.props.entries()) {
    if (installed.has(p.id)) continue;
    const model = await fetchBuffer(`props/${p.id}.glb`);
    if (!model) continue;
    const path = await repo.savePropModel(p.id, model);
    const thumbBuf = p.thumb ? await fetchBuffer(`props/${p.id}.png`) : null;
    const asset: PropAsset = { id: p.id, name: p.name, tags: p.tags, model: { kind: 'glb', path }, grip: p.grip, workCode: null, createdAt: new Date(stamp + i * 1000).toISOString() };
    await repo.saveProp(asset, thumbBuf ? bufferToDataUrl(thumbBuf) : null);
    installed.add(p.id);
    done.props++;
  }

  for (const [i, p] of manifest.poses.entries()) {
    if (installed.has(p.id)) continue;
    const thumbBuf = p.thumb ? await fetchBuffer(`poses/${p.id}.png`) : null;
    // 목록은 새것부터 보이므로 앞 항목이 더 새것이 되게 한다
    const { thumb: _thumb, ...rest } = p;
    void _thumb;
    const pose = normalizePose({ ...rest, groundOnApply: true, createdAt: new Date(stamp + (manifest.poses.length - i) * 1000).toISOString() });
    await repo.savePose(pose, thumbBuf ? bufferToDataUrl(thumbBuf) : null);
    installed.add(p.id);
    done.poses++;
  }

  for (const [i, h] of manifest.handPoses.entries()) {
    const id = h.id ?? '';
    if (!id || installed.has(id)) continue;
    await repo.saveHandPose(normalizeHandPose({ ...h, createdAt: new Date(stamp + (manifest.handPoses.length - i) * 1000).toISOString() }));
    installed.add(id);
    done.handPoses++;
  }

  if (done.props + done.poses + done.handPoses > 0 || force) await repo.writeStarterPackState({ installed: [...installed] });
  return done;
}
