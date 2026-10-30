import { useStore } from '../state/store';
import { posePropCandidates } from './scenes';

/** 포즈에 함께 저장할 소품 고르기: 이 돌이 쥔 소품과 자유 배치된 소품 */
export function PosePropsPicker({ dollId, checked, onChange }: { dollId: string; checked: string[]; onChange: (ids: string[]) => void }) {
  // 컷의 소품이 바뀌면 다시 그린다
  useStore((s) => s.currentCut().props);
  const list = posePropCandidates(dollId);
  if (!list.length) return <div className="muted small">씬에 소품이 없습니다(소품을 놓거나 쥐게 하면 포즈와 함께 저장할 수 있습니다)</div>;
  const toggle = (id: string) => onChange(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="muted small">소품도 함께 저장(돌 기준 위치·각도·크기)</div>
      {list.map((c) => (
        <label key={c.id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={checked.includes(c.id)} onChange={() => toggle(c.id)} />
          {c.name}
          <span className="muted">{c.held ? '· 손에 쥠' : '· 자유 배치'}</span>
        </label>
      ))}
    </div>
  );
}
