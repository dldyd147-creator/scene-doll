import { describe, expect, it } from 'vitest';
import { normalizePose, normalizeScene } from './library';
import { normalizeProp } from './props';
import { normalizeHandPose } from './fingers';

import manifestText from '../../public/presets/manifest.json?raw';

const glbs = new Set(Object.keys(import.meta.glob('../../public/presets/props/*.glb', { query: '?url', import: 'default' })).map((k) => k.replace(/^.*\//, '').replace(/\.glb$/, '')));
const manifest = JSON.parse(manifestText) as {
  props: Array<{ id: string; name: string; tags: string[]; grip: Record<string, unknown> }>;
  poses: Array<{ id: string; name: string; category: string; joints: Record<string, unknown> }>;
  handPoses: Array<{ id: string; name: string; curl: Record<string, number[]> }>;
  scenes: Array<{ id: string; name: string; slots: Array<{ dollId: string; joints: Record<string, unknown> }>; props: Array<{ propId: string }>; situationTags: string[] }>;
};

describe('기본 프리셋 팩', () => {
  it('항목 id가 겹치지 않는다', () => {
    const ids = [...manifest.props, ...manifest.poses, ...manifest.handPoses, ...manifest.scenes].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('소품은 GLB가 있고 쥐는 소품은 양손 쥐기 값이 있다', () => {
    expect(manifest.props.length).toBeGreaterThan(30);
    for (const p of manifest.props) {
      expect(glbs.has(p.id), p.id).toBe(true);
      const grip = p.grip as { left?: unknown; right?: unknown };
      if (grip.left || grip.right) expect(grip.left && grip.right, p.id).toBeTruthy();
      expect(normalizeProp({ ...p, model: { kind: 'glb', path: 'x' } }).name).toBe(p.name);
    }
  });

  it('포즈는 관절값이 있고 분류가 있다', () => {
    expect(manifest.poses.length).toBeGreaterThan(50);
    for (const p of manifest.poses) {
      expect(Object.keys(p.joints).length, p.id).toBeGreaterThan(0);
      expect(normalizePose(p as never).category, p.id).toBeTruthy();
    }
  });

  it('손 모양은 다섯 손가락의 세 마디 값이 있다', () => {
    for (const h of manifest.handPoses) {
      expect(Object.keys(h.curl).sort(), h.id).toEqual(['Index', 'Middle', 'Pinky', 'Ring', 'Thumb']);
      expect(normalizeHandPose(h as never).name).toBe(h.name);
    }
  });
});

describe('기본 씬 팩', () => {
  it('씬은 돌 슬롯과 상황 태그가 있고 쓰는 소품은 팩에 있다', () => {
    expect(manifest.scenes.length).toBeGreaterThan(10);
    const propIds = new Set(manifest.props.map((p) => p.id));
    for (const sc of manifest.scenes) {
      expect(sc.slots.length, sc.id).toBeGreaterThan(0);
      expect(sc.situationTags.length, sc.id).toBeGreaterThan(0);
      for (const p of sc.props) expect(propIds.has(p.propId), `${sc.id}: ${p.propId}`).toBe(true);
      expect(normalizeScene(sc as never).slots.length).toBe(sc.slots.length);
    }
  });
});
