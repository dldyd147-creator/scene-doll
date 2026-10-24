import { useStore } from '../state/store';
import { BONE_LABELS } from '../engine/skeleton';

const MODE_LABEL = { direct: '직접 드래그 (Q)', translate: '이동 기즈모 (W)', rotate: '회전 기즈모 (E)' } as const;

export function StatusBar() {
  const hint = useStore((s) => s.statusHint);
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const characters = useStore((s) => s.characters);
  const dolls = useStore((s) => s.cuts[s.currentCutIndex].dolls);
  const doll = dolls.find((d) => d.id === selection.dollId);
  const chr = doll ? characters.find((c) => c.id === doll.characterId) : undefined;
  const sel = doll ? `${chr?.name ?? '돌'}${selection.bone ? ' · ' + (BONE_LABELS[selection.bone] ?? selection.bone) : ''}` : '선택 없음';
  return (
    <footer className="statusbar">
      <span className="grow">{hint || '휠 드래그: 회전 · Shift+휠 드래그: 팬 · 휠: 줌 · 부위 드래그: 관절 회전 · 손발 핸들: IK'}</span>
      <span>{sel}</span>
      <span>{MODE_LABEL[mode]}</span>
      <span>
        돌 {dolls.length}
      </span>
    </footer>
  );
}
