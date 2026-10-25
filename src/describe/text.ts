import type { Character, Cut, Episode, Work } from '../model/types';
import { colorName, mainReferenceOf } from '../model/defaults';
import { pad3 } from '../storage/backend';
import { ANGLE_LABEL, SHOT_LABEL, type CutAnalysis } from './analyze';

export function formatAspect(aspect: number): string {
  const v = Math.round(aspect * 100) / 100;
  return `1:${v}`;
}

export function pngName(code: string, episodeNo: number, cutNo: number): string {
  return `${code}_${pad3(episodeNo)}_${pad3(cutNo)}.png`;
}

export function mdName(code: string, episodeNo: number): string {
  return `${code}_${pad3(episodeNo)}.md`;
}

function pitchLabel(pitch: number): string {
  const p = Math.round(Math.abs(pitch));
  if (p < 3) return '수평';
  return pitch > 0 ? `올려봄 ${p}°` : `내려봄 ${p}°`;
}

/** 컷 하나의 설명 블록(제목 줄 + 인물 줄 + 카메라 줄 + 메모 줄) */
export function cutBlock(a: CutAnalysis, cut: Cut, code: string, episodeNo: number): string {
  const lines: string[] = [];
  lines.push(`## ${pad3(cut.number)} · ${pngName(code, episodeNo, cut.number)} · ${formatAspect(cut.aspect)} · ${ANGLE_LABEL[a.angle]} · ${SHOT_LABEL[a.shot]} · ${a.count}인`);
  for (const d of a.dolls) {
    const place = d.depthZone ? `${d.xZone} ${d.depthZone}` : d.xZone;
    const pose = d.phrases.length ? `${d.stanceConj} ${d.phrases.join(', ')}` : d.stance;
    lines.push(`${d.colorName} ${d.name}: ${place} · ${d.facing} · ${pose}`);
  }
  const c = a.camera;
  lines.push(`카메라: 높이 ${c.height.toFixed(1)}m · ${c.focal}mm · ${pitchLabel(c.pitch)} · 거리 ${c.distance.toFixed(1)}m`);
  // 글콘티(NTT) 대사·지문: 대사는 줄마다, 지문은 한 줄로
  for (const d of cut.dialogue ?? []) {
    const text = d.text.trim();
    if (!text) continue;
    lines.push(d.speaker.trim() ? `대사(${d.speaker.trim()}): ${text}` : `대사: ${text}`);
  }
  if (cut.scriptNote?.trim()) lines.push(`지문: ${cut.scriptNote.trim().replace(/\s*\n+\s*/g, ' / ')}`);
  if (cut.memo.trim()) lines.push(`메모: ${cut.memo.trim()}`);
  return lines.join('\n');
}

/** 회차 .md 머리말: 작품 정보 + 색 대응표 */
export function episodeHeader(work: Work, episode: Episode, cuts: Cut[], characters: Character[], width: number): string {
  const used = new Set<string>();
  for (const c of cuts) for (const d of c.dolls) used.add(d.characterId);
  const lines: string[] = [];
  lines.push(`# ${work.code} ${pad3(episode.number)} — 컷 설명 (총 ${cuts.length}컷)`);
  lines.push(`작품: ${work.name} · 회차 ${episode.number} · 가로 ${width}px`);
  lines.push('캐릭터(색 = 이름 · 외형 · 레퍼런스):');
  for (const chr of characters) {
    if (!used.has(chr.id)) continue;
    const look = chr.appearanceTags.length ? chr.appearanceTags.join(', ') : chr.info.oneLine?.trim() || '외형 미등록';
    const main = mainReferenceOf(chr);
    const ref = main ? `캐릭터/${chr.name}/${main.file}` : '레퍼런스 없음';
    lines.push(`- ${colorName(chr.color)} = ${chr.name} · ${look} · ${ref}`);
  }
  // 캐릭터 파일이 없는 돌(예: 불러온 옛 데이터)도 색만으로 적어 둔다
  for (const c of cuts) {
    for (const d of c.dolls) {
      if (!characters.some((x) => x.id === d.characterId)) {
        const line = `- ${colorName(d.color)} = (이름 없음) · 외형 미등록 · 레퍼런스 없음`;
        if (!lines.includes(line)) lines.push(line);
      }
    }
  }
  return lines.join('\n');
}

export function episodeMarkdown(work: Work, episode: Episode, cuts: Cut[], characters: Character[], blocks: string[], width: number): string {
  return `${episodeHeader(work, episode, cuts, characters, width)}\n\n${blocks.join('\n\n')}\n`;
}
