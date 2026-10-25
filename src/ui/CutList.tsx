import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { Icon } from './icons';

/** 컷 목록(세로 띠): 확정 컷 썸네일을 웹툰 읽듯 세로 스크롤, 클릭하면 그 씬으로 */
export function CutList() {
  const cuts = useStore((s) => s.cuts);
  const current = useStore((s) => s.currentCutIndex);
  const thumbnails = useStore((s) => s.thumbnails);
  const goToCut = useStore((s) => s.goToCut);
  const insertCutAfter = useStore((s) => s.insertCutAfter);
  const deleteCut = useStore((s) => s.deleteCut);
  const moveCut = useStore((s) => s.moveCut);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const confirmedCount = cuts.filter((c) => c.confirmed).length;
  const listRef = useRef<HTMLDivElement>(null);

  // 현재 컷이 보이도록 스크롤
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [current, cuts.length]);

  return (
    <aside className="panel cutlist-panel">
      <div className="panel-title" title="확정 컷 / 전체 컷">
        컷 <span className="muted">{confirmedCount}/{cuts.length}</span>
      </div>
      <div className="cutlist" ref={listRef}>
        {cuts.map((c, i) => (
          <div
            key={`${c.number}-${i}`}
            data-index={i}
            className={`cut-tile ${i === current ? 'current' : ''} ${c.confirmed ? 'confirmed' : ''}`}
            style={{ aspectRatio: `1 / ${c.aspect}` }}
            title={`컷 ${c.number}${c.confirmed ? ' · 확정' : ' · 작업 중'}${c.memo ? `\n${c.memo}` : ''}`}
            onClick={() => goToCut(i)}
          >
            {thumbnails[c.number] ? <img src={thumbnails[c.number]} alt="" draggable={false} /> : <span className="small muted">{c.confirmed ? '확정' : '작업 중'}</span>}
            <span className="num">{String(c.number).padStart(3, '0')}</span>
            {c.confirmed && <span className="check">✓</span>}
            {(c.generatedImages?.length ?? 0) > 0 && (
              <span className="ai" title={`생성 후보 ${c.generatedImages.length}장`}>
                AI
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="cutlist-tools">
        <button className="icon" onClick={() => moveCut(current, -1)} disabled={current === 0} title="현재 컷을 위로 이동">
          <Icon name="up" />
        </button>
        <button className="icon" onClick={() => moveCut(current, 1)} disabled={current >= cuts.length - 1} title="현재 컷을 아래로 이동">
          <Icon name="down" />
        </button>
        <button className="icon" onClick={() => insertCutAfter(current)} title="현재 컷 아래에 복사해 삽입">
          <Icon name="plus" />
        </button>
        <button className="icon danger" onClick={() => deleteCut(current)} title="현재 컷 삭제">
          <Icon name="trash" />
        </button>
        <button className="export" onClick={() => setExportOpen(true)} title="확정 컷 전체를 PNG + 설명 텍스트로 출력">
          <Icon name="export" /> 출력
        </button>
      </div>
    </aside>
  );
}
