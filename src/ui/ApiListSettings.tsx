import { useEffect, useState } from 'react';
import { KEY_STATE_LABEL, SERVICE_LABEL, SERVICE_MAX_IMAGES, availableOnWeb, keyState, newCustomEntry, normalizeApiList, removeEntry, type ApiEntry } from '../generate/apiList';
import { useKeyStatus } from '../generate/keyStatus';
import { isDesktop } from '../native';
import { useStore } from '../state/store';

function KeyEditor({ entry, onDone }: { entry: ApiEntry; onDone: () => void }) {
  const save = useKeyStatus((s) => s.save);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const r = await save(entry.id, value);
    setValue(''); // 입력칸에서도 바로 지운다
    if (r.ok) onDone();
    else setError(r.reason);
  };
  return (
    <div className="api-key-edit">
      <input
        type="password"
        autoFocus
        value={value}
        placeholder={`${entry.label} API 키를 붙여넣으세요`}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      <button className="primary" onClick={() => void submit()} disabled={!value.trim()}>
        저장
      </button>
      <button
        onClick={() => {
          setValue('');
          onDone();
        }}
      >
        취소
      </button>
      {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

/** 설정 > 이미지 생성 > API 목록. 버튼 한 번으로 현재 항목을 바꾸고, 키는 붙여넣기 → '설정됨 / 바꾸기 / 지우기'만 보인다 */
export function ApiListSettings() {
  const apis = useStore((s) => normalizeApiList(s.settings.genApis));
  const selectedId = useStore((s) => s.settings.genApiId);
  const update = useStore((s) => s.updateSettings);
  const { ids, available, loaded, refresh, clear } = useKeyStatus();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', model: '', baseUrl: '' });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patchEntry = (id: string, patch: Partial<ApiEntry>) => update({ genApis: apis.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const remove = (id: string) => {
    void clear(id);
    update({ genApis: removeEntry(apis, id), genApiId: selectedId === id ? 'venice-flux3' : selectedId });
  };
  const addCustom = () => {
    if (!draft.baseUrl.trim() || !draft.model.trim()) return;
    const entry = newCustomEntry(apis, draft.label, draft.model, draft.baseUrl);
    update({ genApis: [...apis, entry], genApiId: entry.id });
    setDraft({ label: '', model: '', baseUrl: '' });
    setAdding(false);
  };

  return (
    <div className="api-list">
      <div className="small muted">쓸 서비스를 한 번 눌러 고릅니다. 키는 윈도우 계정으로 암호화해 이 PC에만 저장하며, 한 번 저장하면 화면에 다시 보이지 않습니다.</div>
      {isDesktop && loaded && !available && <div className="small" style={{ color: 'var(--danger)' }}>이 PC에서 윈도우 계정 암호화를 쓸 수 없어 키를 저장할 수 없습니다.</div>}
      {apis.map((e) => {
        const selected = e.id === selectedId;
        const state = keyState(e, ids);
        const webBlocked = !isDesktop && !availableOnWeb(e.service);
        return (
          <div key={e.id} className={`api-row ${selected ? 'selected' : ''}`}>
            <div className="api-main">
              <button className={selected ? 'active' : ''} onClick={() => update({ genApiId: e.id })} disabled={webBlocked} title={webBlocked ? '설치형 프로그램에서만 쓸 수 있습니다' : '이 항목으로 이미지를 생성합니다'}>
                {selected ? '● 사용 중' : '○ 사용'}
              </button>
              <div className="api-title">
                <b>{e.label}</b>
                <span className="muted small">
                  {SERVICE_LABEL[e.service]}
                  {e.service !== 'mock' && ` · 이미지 최대 ${SERVICE_MAX_IMAGES[e.service]}장`}
                  {webBlocked && ' · 데스크톱 전용'}
                </span>
              </div>
              {isDesktop && (
                <span className={`api-key-state ${state}`} title={state === 'missing' ? '키를 넣어야 이 항목으로 생성할 수 있습니다' : undefined}>
                  {KEY_STATE_LABEL[state]}
                </span>
              )}
              {isDesktop && state !== 'not-needed' && (
                <>
                  <button onClick={() => setEditing(editing === e.id ? null : e.id)} disabled={!available}>
                    {state === 'set' ? '바꾸기' : '키 넣기'}
                  </button>
                  {state === 'set' && <button onClick={() => void clear(e.id)}>지우기</button>}
                </>
              )}
              {!e.builtin && <button onClick={() => remove(e.id)} title="이 항목과 저장된 키를 지웁니다">삭제</button>}
            </div>
            {e.service !== 'mock' && (
              <div className="api-model">
                <span className="small muted">모델 id</span>
                <input type="text" defaultValue={e.model} key={`${e.id}:${e.model}`} spellCheck={false} onBlur={(ev) => ev.target.value.trim() !== e.model && patchEntry(e.id, { model: ev.target.value.trim() })} />
                {e.service === 'custom' && <span className="small muted">{e.baseUrl}</span>}
              </div>
            )}
            {editing === e.id && <KeyEditor entry={e} onDone={() => setEditing(null)} />}
          </div>
        );
      })}
      {isDesktop && (
        <div className="api-add">
          {adding ? (
            <>
              <div className="small muted">OpenAI 호환 /images/edits 주소를 쓰는 서비스를 추가합니다.</div>
              <input type="text" placeholder="표시 이름" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              <input type="text" placeholder="기준 주소 (예: https://example.com/v1)" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} spellCheck={false} />
              <input type="text" placeholder="모델 id" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} spellCheck={false} />
              <span>
                <button className="primary" onClick={addCustom} disabled={!draft.baseUrl.trim() || !draft.model.trim()}>
                  추가
                </button>{' '}
                <button onClick={() => setAdding(false)}>취소</button>
              </span>
            </>
          ) : (
            <button onClick={() => setAdding(true)}>+ 사용자 정의 항목 추가</button>
          )}
        </div>
      )}
    </div>
  );
}
