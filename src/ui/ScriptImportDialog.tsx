import { useMemo, useRef, useState } from 'react';
import { nowIso } from '../model/defaults';
import { useStore } from '../state/store';
import { columnLetter } from '../script/xlsx';
import { readTableFile } from '../script/table';
import { detectColumns, extractRows, groupByCut, planApply, SCRIPT_FIELDS, type ApplyPlan, type ColumnMapping, type ScriptField } from '../script/ntt';
import { Icon } from './icons';
import { saveNow } from './save';

const PREVIEW_ROWS = 6;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 글콘티(NTT 엑셀·CSV) 가져오기: 파일 → 열 매핑 확인 → 컷별 대사·지문·비고 미리보기 → 회차 컷에 반영 */
export function ScriptImportDialog() {
  const open = useStore((s) => s.scriptImportOpen);
  if (!open) return null;
  return <ImportForm />;
}

function ImportForm() {
  const setOpen = useStore((s) => s.setScriptImportOpen);
  const source = useStore((s) => s.episode.scriptSource);
  const cutCount = useStore((s) => s.cuts.length);
  const applyScript = useStore((s) => s.applyScript);
  const setForced = useStore((s) => s.setScriptBlocksForced);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [done, setDone] = useState<ApplyPlan | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const table = await readTableFile(file.name, await file.arrayBuffer());
      if (!table.length) throw new Error('표에 내용이 없습니다');
      const d = detectColumns(table);
      setRows(table);
      setMapping(d.mapping);
      setHasHeader(d.hasHeader);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const scripts = useMemo(() => (rows.length ? groupByCut(extractRows(rows, mapping, hasHeader)) : []), [rows, mapping, hasHeader]);
  const plan = useMemo(() => planApply(cutCount, scripts), [cutCount, scripts]);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const headerRow = hasHeader ? (rows[0] ?? []) : [];
  const colLabel = (i: number) => `${columnLetter(i)}${headerRow[i]?.trim() ? ` · ${headerRow[i].trim()}` : ''}`;
  const setField = (f: ScriptField, v: string) => setMapping({ ...mapping, [f]: v === '' ? undefined : Number(v) });

  const run = async () => {
    if (!fileName || !scripts.length || busy) return;
    setBusy(true);
    try {
      const p = applyScript(scripts, { fileName, importedAt: nowIso() });
      await saveNow();
      setDone(p);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>
          글콘티 가져오기 <span className="muted small">NTT 엑셀(.xlsx) · CSV</span>
        </h2>
        {source && (
          <div className="muted small">
            현재 글콘티: <b>{source.fileName}</b> · {timeLabel(source.importedAt)} 가져옴. 다시 가져오면 대사·지문을 덮어씁니다.
          </div>
        )}
        <div
          className={`drop-zone ${hover ? 'hover' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHover(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void load(f);
          }}
        >
          <button className="primary" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Icon name="upload" /> 파일 고르기
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xlsm,.csv,.tsv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = '';
            }}
          />
          <span className="muted small">{fileName ? `${fileName} · ${rows.length}행 · 열 ${width}개` : '여기에 끌어다 놓아도 됩니다. 첫 행이 제목 줄(컷·화자·대사·지문·비고)이면 열을 자동으로 잡습니다'}</span>
        </div>
        {rows.length > 0 && (
          <>
            <div className="map-grid">
              <label className="map-field" title="첫 행이 컷·화자·대사 같은 제목이면 켬. 끄면 첫 행도 글콘티로 읽음">
                <span>첫 행은 제목 줄</span>
                <button className={hasHeader ? 'active' : ''} onClick={() => setHasHeader((h) => !h)}>
                  {hasHeader ? '켬' : '끔'}
                </button>
              </label>
              {SCRIPT_FIELDS.map((f) => (
                <label key={f.id} className="map-field" title={f.hint}>
                  <span>{f.label}</span>
                  <select value={mapping[f.id] ?? ''} onChange={(e) => setField(f.id, e.target.value)}>
                    <option value="">없음</option>
                    {Array.from({ length: width }, (_, i) => (
                      <option key={i} value={i}>
                        {colLabel(i)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <table className="script-preview">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>컷</th>
                  <th>대사</th>
                  <th>지문</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {scripts.slice(0, PREVIEW_ROWS).map((g) => (
                  <tr key={g.cut}>
                    <td>{g.cut}</td>
                    <td>{g.dialogue.map((d) => (d.speaker ? `${d.speaker}: ${d.text}` : d.text)).join(' / ')}</td>
                    <td>{g.note}</td>
                    <td>{g.remark}</td>
                  </tr>
                ))}
                {scripts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      읽은 컷이 없습니다. 열 매핑을 확인하세요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {scripts.length > PREVIEW_ROWS && <div className="muted small">… 외 {scripts.length - PREVIEW_ROWS}컷</div>}
            {scripts.length > 0 && (
              <div className="small">
                글콘티 컷 {plan.filled}개(1~{plan.maxCut}) · 현재 컷 {cutCount}개 → {plan.created > 0 ? `모자란 ${plan.created}컷은 마지막 컷을 복사해 만들고` : '컷은 새로 만들지 않고'}
                {plan.leftover.length ? `, 글콘티에 없는 ${plan.leftover.length}컷(${plan.leftover.slice(0, 8).join(', ')}${plan.leftover.length > 8 ? ' …' : ''})은 그대로 둡니다` : ', 모든 컷에 대사·지문이 들어갑니다'}. 대사·지문은 덮어쓰고 비고는 메모에 붙습니다. 컷 순서는 바꾸지 않습니다.
              </div>
            )}
          </>
        )}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        {done && (
          <div style={{ color: 'var(--accent)' }}>
            가져왔습니다: 컷 {done.filled}개 채움 · {done.created}개 새로 만듦{done.leftover.length ? ` · 그대로 둔 컷 ${done.leftover.length}개` : ''}. 원고뷰 위아래에서 대사·지문을 고칠 수 있습니다.
          </div>
        )}
        <div className="actions">
          <button
            className="ghost"
            onClick={() => {
              setForced(true);
              setOpen(false);
            }}
            title="엑셀 없이 원고뷰 위아래의 대사·지문 칸만 켭니다(직접 적기)"
          >
            대사·지문 칸만 켜기
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={() => setOpen(false)}>{done ? '닫기' : '취소'}</button>
          {!done && (
            <button className="primary" disabled={!scripts.length || busy} onClick={() => void run()}>
              <Icon name="check" /> 가져오기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
