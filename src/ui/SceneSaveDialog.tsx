import { useEffect, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { autoTagChips } from '../model/library';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { draftSceneFromCurrent, saveSceneDraft, type SceneDraft } from './scenes';

/** [씬 저장]: 현재 씬을 썸네일·자동 태그와 함께 보여 주고 이름·상황 태그를 받아 공용/씬에 넣는다 */
export function SceneSaveDialog({ engine }: { engine: Engine }) {
  const open = useStore((s) => s.sceneSaveOpen);
  if (!open) return null;
  return <SceneSaveForm engine={engine} />;
}

function SceneSaveForm({ engine }: { engine: Engine }) {
  const setOpen = useStore((s) => s.setSceneSaveOpen);
  const tagButtons = useStore((s) => s.settings.situationTags);
  const [draft, setDraft] = useState<SceneDraft | null>(null);
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 열릴 때 한 번: 현재 컷을 분석(자동 태그)하고 썸네일을 찍는다
  useEffect(() => {
    const d = draftSceneFromCurrent(engine);
    setDraft(d);
    setName(d.item.name);
  }, [engine]);

  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveSceneDraft(draft, name, tags);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const chips = draft ? autoTagChips(draft.item.autoTags) : [];

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal scene-save" onClick={(e) => e.stopPropagation()}>
        <h2>
          씬 저장 <span className="muted small">공용/씬 · 모든 작품에서 씀</span>
        </h2>
        <div className="ss-layout">
          <div className="ss-thumb">{draft ? <img src={draft.thumb} alt="" draggable={false} /> : <span className="muted small">…</span>}</div>
          <div className="ss-form">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="씬 이름" autoFocus spellCheck={false} title="검색어로 쓰이는 이름. 비우면 자동 태그로 이름을 짓습니다" />
            <div className="tag-row" title="프로그램이 붙인 자동 태그: 화면 안 인원 · 샷 · 앵글 · 화면비 · 배치">
              <Icon name="tag" size={13} className="muted" />
              {chips.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
            <div className="tag-row" title="상황 태그: 한두 개만 눌러도 됩니다. 버튼 목록은 설정 > 씬 라이브러리에서 편집">
              {tagButtons.map((t) => (
                <button key={t} className={`tag ${tags.includes(t) ? 'active' : ''}`} onClick={() => toggle(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="muted small">돌 {draft?.item.slots.length ?? 0}개의 배치·포즈와 카메라·화면비를 저장합니다. 캐릭터 지정은 저장하지 않고 불러올 때 슬롯마다 지정합니다.</div>
          </div>
        </div>
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        <div className="actions">
          <button onClick={() => setOpen(false)}>취소</button>
          <button className="primary" disabled={!draft || busy} onClick={() => void save()}>
            <Icon name="bookmarkPlus" /> 저장
          </button>
        </div>
      </div>
    </div>
  );
}
