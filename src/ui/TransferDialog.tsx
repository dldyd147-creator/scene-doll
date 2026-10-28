import { useRef, useState } from 'react';
import { native } from '../native';
import { storage } from '../storage';
import type { WorkInfo } from '../storage/repository';
import { POLICY_LABEL, isValidWorkCode, type ConflictPolicy } from '../transfer/merge';
import { PACKAGE_EXT, PackageError, applyImport, buildPackage, defaultChoices, openPackage, summarizePackage, type ImportChoice, type ImportResult, type ImportSummary, type OpenedPackage } from '../transfer/package';
import { useLibrary } from './library';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(name: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 이동 패키지(.scenedoll) 내보내기·불러오기. 작품 관리 화면에서 연다 */
export function TransferDialog({ works, onClose, onChanged }: { works: WorkInfo[]; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 내보내기
  const [picked, setPicked] = useState<Set<string>>(() => new Set(works.map((w) => w.work.code)));
  const [shared, setShared] = useState(true);
  const [generated, setGenerated] = useState(false);
  const [output, setOutput] = useState(false);

  // 불러오기
  const [pkg, setPkg] = useState<OpenedPackage | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  const [includeShared, setIncludeShared] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (code: string) =>
    setPicked((cur) => {
      const n = new Set(cur);
      if (!n.delete(code)) n.add(code);
      return n;
    });

  const doExport = async () => {
    setBusy('준비 중…');
    setError(null);
    setNote(null);
    try {
      const { data, manifest } = await buildPackage(storage.backend, { works: [...picked], shared, generated, output }, (d, t, label) => setBusy(`담는 중 ${d}/${t} ${label}`));
      const name = `씬돌_이동_${stamp()}.${PACKAGE_EXT}`;
      if (native) {
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const saved = await native.dialog.saveFile(name, buf, '씬 돌 이동 파일', PACKAGE_EXT);
        setNote(saved ? `저장했습니다: ${saved}` : '저장을 취소했습니다');
      } else {
        downloadBlob(name, data);
        setNote(`${name} 을(를) 내려받았습니다`);
      }
      setNote((n) => `${n} (작품 ${manifest.works.length}개 · 파일 ${manifest.files}개 · ${mb(data.length)})`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const loadBytes = async (bytes: Uint8Array) => {
    setBusy('읽는 중…');
    setError(null);
    setResult(null);
    try {
      const opened = openPackage(bytes);
      const sum = await summarizePackage(storage.backend, opened);
      const used = new Set(works.map((w) => w.work.code));
      for (const w of sum.works) used.add(w.code);
      setPkg(opened);
      setSummary(sum);
      setChoices(defaultChoices(sum, used));
    } catch (e) {
      setPkg(null);
      setSummary(null);
      setError(e instanceof PackageError ? e.message : message(e));
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async () => {
    if (native) {
      const f = await native.dialog.openFile('씬 돌 이동 파일', PACKAGE_EXT);
      if (f) await loadBytes(new Uint8Array(f.data));
    } else fileRef.current?.click();
  };

  const doImport = async () => {
    if (!pkg || !summary) return;
    setBusy('합치는 중…');
    setError(null);
    try {
      const r = await applyImport(storage.backend, pkg, { choices, shared: includeShared }, (d, t) => setBusy(`합치는 중 ${d}/${t}`));
      setResult(r);
      useLibrary.setState({ scenes: null, poses: null, props: null, handPoses: null });
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const setPolicy = (code: string, policy: ConflictPolicy) => setChoices((c) => ({ ...c, [code]: { ...c[code], policy } }));

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>이동 파일(.{PACKAGE_EXT})</h2>
        <div className="small muted">쌓아 둔 작품·캐릭터·레퍼런스·돌 설정·소품·포즈·씬을 파일 하나로 내보내 다른 곳으로 옮기거나, 받은 파일을 지금 작업 폴더에 합칩니다. API 키와 연결 토큰은 담기지 않습니다.</div>
        <div className="segmented" style={{ margin: '8px 0' }}>
          <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>
            내보내기
          </button>
          <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
            불러오기(합치기)
          </button>
        </div>

        {tab === 'export' && (
          <div className="transfer-section">
            <div className="row" style={{ gap: 8 }}>
              <b>작품</b>
              <button onClick={() => setPicked(new Set(works.map((w) => w.work.code)))}>전체</button>
              <button onClick={() => setPicked(new Set())}>선택 해제</button>
            </div>
            <div className="transfer-works">
              {works.map((w) => (
                <label key={w.work.code} className="transfer-work">
                  <input type="checkbox" checked={picked.has(w.work.code)} onChange={() => toggle(w.work.code)} />
                  <b>{w.work.code}</b> {w.work.name}
                  <span className="muted small">
                    회차 {w.episodes.length} · 캐릭터 {w.characters.length}
                  </span>
                </label>
              ))}
              {works.length === 0 && <div className="muted small">내보낼 작품이 없습니다.</div>}
            </div>
            <label>
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> 공용 라이브러리(씬·포즈·손 모양·소품 + GLB) 포함
            </label>
            <label>
              <input type="checkbox" checked={generated} onChange={(e) => setGenerated(e.target.checked)} /> 생성 후보 이미지 포함 <span className="muted small">(용량이 큽니다)</span>
            </label>
            <label>
              <input type="checkbox" checked={output} onChange={(e) => setOutput(e.target.checked)} /> 출력 PNG 포함 <span className="muted small">(용량이 큽니다)</span>
            </label>
            <div className="actions">
              <button className="primary" onClick={() => void doExport()} disabled={!!busy || (picked.size === 0 && !shared)}>
                내보내기…
              </button>
            </div>
          </div>
        )}

        {tab === 'import' && (
          <div className="transfer-section">
            <input
              ref={fileRef}
              type="file"
              accept={`.${PACKAGE_EXT}`}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void f.arrayBuffer().then((b) => loadBytes(new Uint8Array(b)));
              }}
            />
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <button onClick={() => void pickFile()} disabled={!!busy}>
                파일 고르기…
              </button>
            </div>
            {summary && (
              <>
                <div className="card small">
                  <b>
                    작품 {summary.works.length}개 · 캐릭터 {summary.characters}명
                  </b>
                  <div>
                    씬 {summary.shared.scenes} · 포즈 {summary.shared.poses} · 손 모양 {summary.shared.handPoses} · 소품 {summary.shared.props}
                  </div>
                  <div className="muted">
                    파일 {summary.files}개 · {mb(summary.bytes)} · 내보낸 때 {summary.exportedAt.slice(0, 16).replace('T', ' ')}
                  </div>
                </div>
                <div className="transfer-works">
                  {summary.works.map((w) => {
                    const c = choices[w.code];
                    const policy = c?.policy ?? 'merge';
                    return (
                      <div key={w.code} className="transfer-work">
                        <b>{w.code}</b> {w.name}
                        <span className="muted small">
                          회차 {w.episodes} · 캐릭터 {w.characters} · {mb(w.bytes)}
                        </span>
                        {w.conflict ? (
                          <>
                            <span className="small" style={{ color: 'var(--danger)' }}>이미 있는 작품 →</span>
                            <select value={policy} onChange={(e) => setPolicy(w.code, e.target.value as ConflictPolicy)}>
                              {(['merge', 'skip', 'overwrite', 'rename'] as const).map((p) => (
                                <option key={p} value={p}>
                                  {POLICY_LABEL[p]}
                                </option>
                              ))}
                            </select>
                            {policy === 'rename' && (
                              <input
                                type="text"
                                maxLength={3}
                                value={c?.newCode ?? ''}
                                style={{ width: 56 }}
                                title="새 작품 코드(영문 대문자 3자)"
                                onChange={(e) => setChoices((cc) => ({ ...cc, [w.code]: { ...cc[w.code], policy: 'rename', newCode: e.target.value.toUpperCase() } }))}
                              />
                            )}
                          </>
                        ) : (
                          <span className="muted small">새 작품으로 추가</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <label>
                  <input type="checkbox" checked={includeShared} onChange={(e) => setIncludeShared(e.target.checked)} /> 공용 라이브러리도 합치기(같은 id는 수정 시각이 새로운 쪽)
                </label>
                <div className="small muted">합치기: 같은 파일은 수정 시각(updatedAt)이 새로운 쪽을 씁니다. 덮어쓰기: 겹치는 파일을 전부 가져온 쪽으로. 둘 다 남기기: 가져온 작품을 새 코드로 추가. 기존 파일은 지우지 않습니다.</div>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => void doImport()}
                    disabled={!!busy || Object.entries(choices).some(([k, c]) => summary.works.find((w) => w.code === k)?.conflict && c.policy === 'rename' && !isValidWorkCode((c.newCode ?? '').toUpperCase()))}
                  >
                    불러오기
                  </button>
                </div>
              </>
            )}
            {result && (
              <div className="card small">
                추가 {result.added}개 · 갱신 {result.updated}개 · 유지(기존이 새롭거나 같음) {result.kept}개
                {result.skippedWorks.length > 0 && <div>건너뜀: {result.skippedWorks.join(', ')}</div>}
                {result.renamed.map((r) => (
                  <div key={r.from}>
                    {r.from} → 새 작품 {r.to}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {busy && <div className="small">{busy}</div>}
        {note && <div className="small">{note}</div>}
        {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
        <div className="actions">
          <button onClick={onClose} disabled={!!busy}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
