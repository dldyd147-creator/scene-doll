import { useStore } from '../state/store';

/** 컷 목록(세로 띠). 1단계 5번째 하위 단계에서 썸네일·확정·이동이 붙는다 */
export function CutList() {
  const cuts = useStore((s) => s.cuts);
  const current = useStore((s) => s.currentCutIndex);
  return (
    <aside className="panel">
      <div className="panel-title">컷</div>
      <div className="cutlist" style={{ display: 'flex', flexDirection: 'column' }}>
        {cuts.map((c, i) => (
          <div key={c.number} className={`cut-tile ${i === current ? 'current' : ''}`} style={{ aspectRatio: `1 / ${c.aspect}` }} title={`컷 ${c.number}`}>
            <span className="num">{String(c.number).padStart(3, '0')}</span>
            <span className="small">{c.confirmed ? '확정' : '작업 중'}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
