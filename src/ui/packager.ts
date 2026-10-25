import type { CutAnalysis, DollAnalysis } from '../describe/analyze';
import { ANGLE_LABEL, SHOT_LABEL } from '../describe/analyze';
import { formatAspect, pngName } from '../describe/text';
import { colorName, mainReferenceOf, refLabel } from '../model/defaults';
import type { Character, Cut, Episode, Work } from '../model/types';
import { pad3 } from '../storage/backend';
import { storage } from '../storage';

/**
 * AI 전달 패키지(2단계). 컷 이미지 + 장면 정보 + 돌에 지정된 캐릭터 정보(레퍼런스 포함)를
 * 패키지/{작품코드}/{회차}/ 아래에 컷 폴더·캐릭터 시트·회차 요약으로 묶는다.
 * 5단계 이미지 API 호출은 이 폴더를 그대로 입력으로 쓴다.
 */

export interface PackageReference {
  label: string;
  /** 컷 폴더 기준 상대 경로 */
  path: string;
  main: boolean;
}

export interface PackageCharacter {
  color: string;
  colorName: string;
  name: string;
  characterId: string;
  /** 캐릭터 관리에 등록된 캐릭터인가(아니면 임시) */
  registered: boolean;
  gender: 'male' | 'female' | 'other';
  heightCm: number;
  age?: number;
  role?: string;
  oneLine?: string;
  description: string;
  appearanceTags: string[];
  placement: string;
  facing: string;
  pose: string;
  shot: string;
  references: PackageReference[];
  /** 레퍼런스가 없을 때 AI에게 줄 대체 지시 */
  fallback?: string;
}

export interface CutPackage {
  work: { code: string; name: string };
  episode: number;
  cut: number;
  image: string;
  /** 출력 묶음(선화·깊이·색 마스크) 파일 이름. 묶음을 뽑았을 때만 */
  images?: { line: string; depth: string; mask: string };
  frame: { aspect: string; width: number; height: number; shot: string; angle: string; count: number };
  camera: { height: number; focal: number; pitch: number; yaw: number; roll: number; distance: number };
  scene: { description: string; memo: string; dialogue: NonNullable<Cut['dialogue']>; scriptNote: string };
  characters: PackageCharacter[];
  prompt: string;
}

const GENDER_LABEL = { male: '남', female: '여', other: '기타' } as const;

/** 파일명으로 쓸 수 있는 이름(없으면 id) */
export function safeFolderName(name: string, fallback: string): string {
  const s = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return s || fallback;
}

/** 패키지 안 캐릭터 폴더 이름(같은 이름이 둘이면 id 꼬리표) */
export function characterFolders(characters: Character[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const c of characters) {
    let folder = safeFolderName(c.name, c.id);
    if (used.has(folder)) folder = `${folder}_${c.id.slice(-4)}`;
    used.add(folder);
    out.set(c.id, folder);
  }
  return out;
}

function fallbackFor(gender: PackageCharacter['gender'], heightCm: number): string {
  const g = gender === 'female' ? '여성' : gender === 'male' ? '남성' : '인물';
  return `레퍼런스 없음: 임의의 ${g}(키 ${heightCm}cm)으로 그리되 이 회차 안에서는 같은 인물로 보이게 일관되게 유지`;
}

function packageCharacter(d: DollAnalysis, chr: Character | undefined, folders: Map<string, string>, dollGender: PackageCharacter['gender'], heightCm: number): PackageCharacter {
  const registered = !!chr && !chr.temporary;
  const gender = chr?.info.gender ?? dollGender;
  const refs: PackageReference[] = registered && chr ? chr.references.map((r) => ({ label: refLabel(r), path: `../캐릭터/${folders.get(chr.id)}/${r.file}`, main: mainReferenceOf(chr)?.id === r.id })) : [];
  const pose = d.phrases.length ? `${d.stanceConj} ${d.phrases.join(', ')}` : d.stance;
  return {
    color: d.color,
    colorName: d.colorName,
    name: chr?.name ?? d.name,
    characterId: d.characterId,
    registered,
    gender,
    heightCm: chr?.heightCm ?? heightCm,
    age: chr?.info.age,
    role: chr?.info.role,
    oneLine: chr?.info.oneLine,
    description: chr?.description ?? '',
    appearanceTags: chr?.appearanceTags ?? [],
    placement: d.depthZone ? `${d.xZone} ${d.depthZone}` : d.xZone,
    facing: d.facing,
    pose,
    shot: SHOT_LABEL[d.shot],
    references: refs,
    fallback: refs.length ? undefined : fallbackFor(gender, chr?.heightCm ?? heightCm),
  };
}

function pitchLabel(pitch: number): string {
  const p = Math.round(Math.abs(pitch));
  if (p < 3) return '수평';
  return pitch > 0 ? `올려봄 ${p}°` : `내려봄 ${p}°`;
}

/** 컷 하나의 생성 지시문(이미지 API에 그대로 붙이는 한국어 프롬프트) */
export function buildPrompt(p: Omit<CutPackage, 'prompt'>): string {
  const L: string[] = [];
  L.push(`# ${p.work.code}_${pad3(p.episode)}_${pad3(p.cut)} — 웹툰 컷 생성 지시`);
  L.push(`첨부한 \`${p.image}\`는 3D 돌로 짠 웹툰 콘티 컷이다. 돌의 포즈·구도·카메라 앵글을 그대로 따라 완성된 웹툰 컷을 그려라. 화면비 ${p.frame.aspect}, 가로 ${p.frame.width}px.`);
  L.push('돌은 색으로 캐릭터를 구분한다. 같은 색의 돌은 아래 캐릭터다.');
  L.push('');
  L.push(`## 화면 안 캐릭터 ${p.characters.length}명`);
  if (!p.characters.length) L.push('(화면 안에 인물이 없다. 배경·상황만 그린다)');
  for (const c of p.characters) {
    L.push(`### ${c.colorName} 돌 = ${c.name}${c.registered ? '' : ' (미등록)'}`);
    L.push(`- 위치 ${c.placement} · ${c.facing} · ${c.pose} · ${c.shot}`);
    const facts = [`성별 ${GENDER_LABEL[c.gender]}`, `키 ${c.heightCm}cm`];
    if (c.age !== undefined) facts.push(`나이 ${c.age}`);
    if (c.role) facts.push(`역할 ${c.role}`);
    L.push(`- ${facts.join(' · ')}`);
    if (c.oneLine) L.push(`- 한 줄: ${c.oneLine}`);
    if (c.appearanceTags.length) L.push(`- 외형: ${c.appearanceTags.join(', ')}`);
    if (c.description.trim()) L.push(`- 설명: ${c.description.trim().replace(/\s*\n+\s*/g, ' / ')}`);
    if (c.references.length) L.push(`- 레퍼런스(얼굴·머리·복장을 이 그림들에 맞출 것): ${c.references.map((r) => `${r.label} \`${r.path}\`${r.main ? ' (대표)' : ''}`).join(', ')}`);
    else if (c.fallback) L.push(`- ${c.fallback}`);
  }
  L.push('');
  L.push('## 장면');
  L.push(`- 샷 ${p.frame.shot} · 앵글 ${p.frame.angle} · 카메라 높이 ${p.camera.height.toFixed(1)}m · ${p.camera.focal}mm · ${pitchLabel(p.camera.pitch)} · 거리 ${p.camera.distance.toFixed(1)}m`);
  if (p.scene.dialogue.length) L.push(`- 대사: ${p.scene.dialogue.map((d) => `${d.speaker ? d.speaker + ': ' : ''}"${d.text}"`).join(' / ')}`);
  if (p.scene.scriptNote.trim()) L.push(`- 지문: ${p.scene.scriptNote.trim()}`);
  if (p.scene.memo.trim()) L.push(`- 메모: ${p.scene.memo.trim()}`);
  L.push('- 컷 설명(자동):');
  for (const line of p.scene.description.split('\n')) L.push(`  ${line}`);
  L.push('');
  L.push('## 규칙');
  L.push('- 돌의 자세, 카메라 앵글, 인물의 화면 위치와 크기를 바꾸지 않는다.');
  L.push('- 레퍼런스가 있는 캐릭터는 얼굴·머리 모양·복장을 레퍼런스에 맞춘다. 레퍼런스가 없는 돌은 위 지시대로 임의의 인물로 그리되 회차 안에서 일관되게 유지한다.');
  L.push('- 화면 밖 인물은 그리지 않는다. 배경은 메모·지문을 따르고, 없으면 단순하게 둔다.');
  return L.join('\n') + '\n';
}

export function buildCutPackage(work: Work, episode: Episode, cut: Cut, analysis: CutAnalysis, characters: Character[], folders: Map<string, string>, width: number, block: string): CutPackage {
  const chars: PackageCharacter[] = analysis.dolls.map((d) => {
    const inst = cut.dolls.find((x) => x.id === d.id);
    const chr = characters.find((c) => c.id === d.characterId);
    const dollGender: PackageCharacter['gender'] = inst?.dollId.endsWith('_f') ? 'female' : 'male';
    return packageCharacter(d, chr, folders, dollGender, inst?.heightCm ?? 175);
  });
  const base: Omit<CutPackage, 'prompt'> = {
    work: { code: work.code, name: work.name },
    episode: episode.number,
    cut: cut.number,
    image: pngName(work.code, episode.number, cut.number),
    frame: { aspect: formatAspect(cut.aspect), width, height: Math.round(width * cut.aspect), shot: SHOT_LABEL[analysis.shot], angle: ANGLE_LABEL[analysis.angle], count: analysis.count },
    camera: { height: cut.camera.position[1], focal: cut.camera.focalLength, pitch: cut.camera.pitch, yaw: cut.camera.yaw, roll: cut.camera.roll, distance: analysis.camera.distance },
    scene: { description: block, memo: cut.memo, dialogue: cut.dialogue ?? [], scriptNote: cut.scriptNote ?? '' },
    characters: chars,
  };
  return { ...base, prompt: buildPrompt(base) };
}

/** 컷 폴더에 PNG·패키지 JSON·프롬프트를 쓴다 */
export async function writeCutPackage(pkg: CutPackage, png: Blob): Promise<void> {
  const repo = storage.repository;
  const dir = pad3(pkg.cut);
  await repo.writePackage(pkg.work.code, pkg.episode, `${dir}/${pkg.image}`, png);
  await repo.writePackage(pkg.work.code, pkg.episode, `${dir}/${pkg.work.code}_${pad3(pkg.episode)}_${pad3(pkg.cut)}.json`, JSON.stringify(pkg, null, 2));
  await repo.writePackage(pkg.work.code, pkg.episode, `${dir}/prompt.md`, pkg.prompt);
}

/** 캐릭터 시트(이름.md + 레퍼런스 이미지 복사). 등록 캐릭터만 폴더를 만든다 */
export async function writeCharacterSheets(work: Work, episode: Episode, characters: Character[], folders: Map<string, string>): Promise<string[]> {
  const repo = storage.repository;
  const written: string[] = [];
  for (const chr of characters) {
    if (chr.temporary) continue;
    const folder = folders.get(chr.id)!;
    const main = mainReferenceOf(chr);
    const L: string[] = [];
    L.push(`# ${chr.name}`);
    L.push(`- 고정색: ${colorName(chr.color)} (${chr.color})`);
    const facts = [`성별 ${GENDER_LABEL[chr.info.gender]}`, `키 ${chr.heightCm}cm`];
    if (chr.info.age !== undefined) facts.push(`나이 ${chr.info.age}`);
    if (chr.info.role) facts.push(`역할 ${chr.info.role}`);
    L.push(`- ${facts.join(' · ')}`);
    if (chr.info.oneLine) L.push(`- 한 줄: ${chr.info.oneLine}`);
    if (chr.appearanceTags.length) L.push(`- 외형 태그: ${chr.appearanceTags.join(', ')}`);
    if (chr.description.trim()) L.push(`- 설명: ${chr.description.trim()}`);
    L.push(`- 레퍼런스 ${chr.references.length}장:`);
    for (const r of chr.references) {
      L.push(`  - ${refLabel(r)} → ${r.file}${main?.id === r.id ? ' (대표)' : ''}`);
      const buf = await repo.readReference(work.code, chr.id, r.file).catch(() => null);
      if (buf) await repo.writePackage(work.code, episode.number, `캐릭터/${folder}/${r.file}`, buf);
    }
    await repo.writePackage(work.code, episode.number, `캐릭터/${folder}/${folder}.md`, L.join('\n') + '\n');
    written.push(folder);
  }
  return written;
}

export interface EpisodeSummary {
  work: { code: string; name: string };
  episode: number;
  title?: string;
  width: number;
  generatedAt: string;
  cuts: Array<{ number: number; folder: string; image: string; json: string; prompt: string; shot: string; angle: string; count: number; characters: string[] }>;
  characters: Array<{ name: string; color: string; colorName: string; registered: boolean; folder: string | null; references: number }>;
}

/** 회차 요약 JSON + 회차 설명 .md */
export async function writeEpisodeSummary(work: Work, episode: Episode, width: number, packages: CutPackage[], characters: Character[], folders: Map<string, string>, markdown: string): Promise<void> {
  const repo = storage.repository;
  const usedIds = new Set<string>();
  for (const p of packages) for (const c of p.characters) usedIds.add(c.characterId);
  const summary: EpisodeSummary = {
    work: { code: work.code, name: work.name },
    episode: episode.number,
    title: episode.title,
    width,
    generatedAt: new Date().toISOString(),
    cuts: packages.map((p) => ({
      number: p.cut,
      folder: pad3(p.cut),
      image: `${pad3(p.cut)}/${p.image}`,
      json: `${pad3(p.cut)}/${work.code}_${pad3(episode.number)}_${pad3(p.cut)}.json`,
      prompt: `${pad3(p.cut)}/prompt.md`,
      shot: p.frame.shot,
      angle: p.frame.angle,
      count: p.frame.count,
      characters: p.characters.map((c) => c.name),
    })),
    characters: characters
      .filter((c) => usedIds.has(c.id))
      .map((c) => ({ name: c.name, color: c.color, colorName: colorName(c.color), registered: !c.temporary, folder: c.temporary ? null : (folders.get(c.id) ?? null), references: c.temporary ? 0 : c.references.length })),
  };
  await repo.writePackage(work.code, episode.number, '회차.json', JSON.stringify(summary, null, 2));
  await repo.writePackage(work.code, episode.number, `${work.code}_${pad3(episode.number)}.md`, markdown);
}
