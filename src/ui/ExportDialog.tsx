import { useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';
import { exportEpisode, type ExportProgress, type ExportResult } from './exporter';

export function ExportDialog({ engine }: { engine: Engine }) {
  const open = useStore((s) => s.exportOpen);
  const setOpen = useStore((s) => s.setExportOpen);
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const cuts = useStore((s) => s.cuts);
  const storageKind = useStore((s) => s.storageKind);
  const updateOutput = useStore((s) => s.updateOutputSettings);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withPackage, setWithPackage] = useState(true);
  const [withBundle, setWithBundle] = useState(true);
  const signal = useRef({ cancelled: false });
  if (!open) return null;
  const confirmed = cuts.filter((c) => c.confirmed).length;
  const running = !!progress && !result && !error;

  const start = async () => {
    setError(null);
    setResult(null);
    signal.current = { cancelled: false };
    setProgress({ done: 0, total: confirmed, current: '' });
    try {
      const r = await exportEpisode(engine, setProgress, signal.current, { withPackage, withBundle });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const close = () => {
    if (running) signal.current.cancelled = true;
    setProgress(null);
    setResult(null);
    setError(null);
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>회차 일괄 출력</h2>
        <div className="muted small">
          확정된 컷 {confirmed}개를 원고뷰와 같은 카메라·화면비로 가로 {work.output.width}px PNG로 그리고, 회차 설명 <code>{work.code}_{String(episode.number).padStart(3, '0')}.md</code>와 컷별 JSON을 함께 씁니다.
        </div>
        <div className="setting">
          <span>저장 위치</span>
          <span className="small">
            {storageKind === 'folder' ? '작업 폴더' : '브라우저 내부 저장'} / 출력/{work.code}/{String(episode.number).padStart(3, '0')}/
          </span>
          <span />
        </div>
        {storageKind !== 'folder' && <div className="small" style={{ color: 'var(--accent)' }}>작업 폴더를 지정하지 않아 브라우저 안에 저장됩니다. 탐색기에서 보려면 먼저 상단의 작업 폴더 지정을 누르세요.</div>}
        <div className="setting">
          <span>AI 전달 패키지</span>
          <span>
            <button className={withPackage ? 'active' : ''} onClick={() => setWithPackage(!withPackage)} title="패키지/{작품}/{회차}/ 에 컷 폴더(PNG·패키지 JSON·프롬프트)·캐릭터 시트(설명·레퍼런스)·회차 요약을 함께 씁니다. 5단계 이미지 생성의 입력">
              {withPackage ? '함께 추출' : '추출 안 함'}
            </button>
          </span>
          <span />
        </div>
        <div className="setting">
          <span>선화·깊이·색 마스크 묶음</span>
          <span>
            <button className={withBundle ? 'active' : ''} onClick={() => setWithBundle(!withBundle)} title="컷마다 _line(흰 돌 + 외곽선·십자선), _depth(가까울수록 밝음), _mask(캐릭터 고정색 평면, 배경 투명) PNG를 출력 폴더와 패키지 컷 폴더에 함께 씁니다. 이미지 생성의 컨트롤 입력용">
              {withBundle ? '함께 출력' : '출력 안 함'}
            </button>
          </span>
          <span />
        </div>
        <h3>출력 설정</h3>
        <div className="setting">
          <span>배경</span>
          <span className="segmented">
            <button className={work.output.background === 'white' ? 'active' : ''} onClick={() => updateOutput({ background: 'white' })}>
              흰색
            </button>
            <button className={work.output.background === 'transparent' ? 'active' : ''} onClick={() => updateOutput({ background: 'transparent' })}>
              투명
            </button>
          </span>
          <span />
        </div>
        <div className="setting">
          <span>십자선</span>
          <span>
            <button className={work.output.crosshair ? 'active' : ''} onClick={() => updateOutput({ crosshair: !work.output.crosshair })}>
              {work.output.crosshair ? '포함' : '제외'}
            </button>
          </span>
          <span />
        </div>
        <div className="setting">
          <span>2단 명암</span>
          <span>
            <button className={work.output.shading ? 'active' : ''} onClick={() => updateOutput({ shading: !work.output.shading })}>
              {work.output.shading ? '포함' : '제외'}
            </button>
          </span>
          <span />
        </div>
        <div className="setting">
          <span>가로 해상도</span>
          <span className="segmented">
            {[1024, 1536, 2048].map((w) => (
              <button key={w} className={work.output.width === w ? 'active' : ''} onClick={() => updateOutput({ width: w })}>
                {w}px
              </button>
            ))}
          </span>
          <span />
        </div>

        {progress && (
          <div className="progress">
            <div className="bar">
              <div className="fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <div className="small muted">
              {progress.done}/{progress.total} {progress.current}
            </div>
          </div>
        )}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        {result && (
          <div className="small">
            <div>
              완료: PNG {result.count}장 · 설명 .md 1개 · 컷 JSON {result.count}개 → <code>{result.folder}</code>
            </div>
            {result.packageFolder && (
              <div>
                AI 전달 패키지: 컷 폴더 {result.count}개(PNG·JSON·prompt.md) + 캐릭터 시트 + 회차.json → <code>{result.packageFolder}</code>
              </div>
            )}
            {result.failed.length > 0 && <div style={{ color: 'var(--danger)' }}>실패: {result.failed.join(', ')}</div>}
            <details style={{ marginTop: 8 }}>
              <summary>설명 텍스트 미리보기</summary>
              <pre className="md-preview">{result.markdown}</pre>
            </details>
          </div>
        )}

        <div className="actions">
          <button onClick={close}>{running ? '중단' : '닫기'}</button>
          <button className="primary" onClick={() => void start()} disabled={running || confirmed === 0}>
            {confirmed === 0 ? '확정된 컷 없음' : running ? '출력 중…' : `출력 시작 (${confirmed}컷)`}
          </button>
        </div>
      </div>
    </div>
  );
}
