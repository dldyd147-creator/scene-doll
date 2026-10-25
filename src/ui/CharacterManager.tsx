import { useCallback, useEffect, useRef, useState } from 'react';
import type { Character, Gender, ReferenceImage, RefSlot } from '../model/types';
import { CHARACTER_COLORS, CHARACTER_ROLES, createCharacter, DOLL_ASSETS, MAX_CUSTOM_REFS, nowIso, pickColor, REF_SLOTS, refLabel, sortCharacters, type CharacterRole } from '../model/defaults';
import { newId } from '../model/ids';
import { useStore } from '../state/store';
import { storage } from '../storage';
import { Icon } from './icons';
import { forgetRefUrl, useRefUrl } from './refImages';
import { reloadCharacters } from './save';

/** 캐릭터 관리 대화상자(스토어의 characterManagerFor 작품). 작품에 종속된 캐릭터의 설명·레퍼런스·돌 지정을 다룬다 */
export function CharacterManager() {
  const code = useStore((s) => s.characterManagerFor);
  const screen = useStore((s) => s.screen);
  const workCode = useStore((s) => s.work.code);
  const setFor = useStore((s) => s.setCharacterManagerFor);
  if (!code) return null;
  const close = () => {
    setFor(null);
    // 편집 중인 작품이면 바뀐 캐릭터를 문서에도 반영한다
    if (screen === 'editor' && workCode === code) void reloadCharacters();
  };
  return <CharacterManagerDialog workCode={code} onClose={close} />;
}

type UploadTarget = { kind: 'slot'; slot: RefSlot } | { kind: 'custom'; refId?: string };

function extOf(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^(png|jpe?g|webp|gif)$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  const t = file.type.split('/')[1];
  return t === 'jpeg' ? 'jpg' : t || 'png';
}

/** 숫자 칸: 치는 동안은 그대로 두고, 칸을 떠나거나 Enter를 칠 때 범위 안으로 맞춰 반영한다(치는 중에 50·250으로 튀지 않게) */
function NumberField({ value, min, max, width, title, placeholder, allowEmpty, onCommit }: { value: number | undefined; min: number; max: number; width: number; title?: string; placeholder?: string; allowEmpty?: boolean; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    const text = latest.current;
    if (text.trim() === '') {
      if (allowEmpty) onCommit(undefined);
      else setText(value === undefined ? '' : String(value));
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(value === undefined ? '' : String(value));
      return;
    }
    const v = Math.max(min, Math.min(max, Math.round(n)));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        latest.current = e.target.value;
        setText(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={{ width }}
      title={title}
    />
  );
}

const parseTags = (s: string): string[] => s.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);

/** 쉼표로 나누는 태그 칸: 친 글(쉼표·빈칸 포함)은 그대로 보여 주고, 태그 목록만 따로 반영한다 */
function TagsField({ tags, placeholder, onCommit }: { tags: string[]; placeholder?: string; onCommit: (tags: string[]) => void }) {
  const joined = tags.join(', ');
  const [text, setText] = useState(joined);
  useEffect(() => {
    setText((cur) => (parseTags(cur).join(', ') === joined ? cur : joined));
  }, [joined]);
  return (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(parseTags(e.target.value));
      }}
    />
  );
}

export function CharacterManagerDialog({ workCode, onClose }: { workCode: string; onClose: () => void }) {
  const [list, setList] = useState<Character[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(new Map<string, Character>());
  const timer = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<UploadTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const chars = (await storage.repository.loadCharacters(workCode)).filter((c) => !c.temporary);
      setList(chars);
      setSelectedId((cur) => cur ?? sortCharacters(chars)[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const pending = [...dirty.current.values()];
    dirty.current.clear();
    for (const c of pending) {
      try {
        await storage.repository.saveCharacter(workCode, c);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [workCode]);

  const update = (id: string, patch: Partial<Character>) => {
    setList((l) => {
      if (!l) return l;
      const next = l.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: nowIso() } : c));
      const changed = next.find((c) => c.id === id);
      if (changed) dirty.current.set(id, changed);
      return next;
    });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 400);
  };

  const close = useCallback(async () => {
    await flush();
    onClose();
  }, [flush, onClose]);

  // Esc로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const add = async () => {
    const used = (list ?? []).map((c) => c.color);
    const chr = createCharacter(workCode, `캐릭터 ${(list?.length ?? 0) + 1}`, 'male', pickColor(used));
    try {
      await storage.repository.saveCharacter(workCode, chr);
      setList((l) => [...(l ?? []), chr]);
      setSelectedId(chr.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (chr: Character) => {
    if (!window.confirm(`캐릭터 "${chr.name}"와 레퍼런스 이미지를 지울까요? 컷에 놓인 돌은 남지만 이름·레퍼런스 연결은 사라집니다.`)) return;
    dirty.current.delete(chr.id);
    try {
      await storage.repository.deleteCharacter(workCode, chr.id);
      for (const r of chr.references) forgetRefUrl(workCode, chr.id, r.file);
      setList((l) => (l ?? []).filter((c) => c.id !== chr.id));
      setSelectedId((cur) => (cur === chr.id ? null : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const selected = list?.find((c) => c.id === selectedId) ?? null;

  const pickFile = (target: UploadTarget) => {
    uploadTarget.current = target;
    fileInput.current?.click();
  };

  const upload = async (chr: Character, file: File, target: UploadTarget) => {
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 등록할 수 있습니다');
      return;
    }
    const ext = extOf(file);
    const id = target.kind === 'custom' && target.refId ? target.refId : newId('ref');
    const fileName = `${target.kind === 'slot' ? target.slot : 'extra'}_${id.slice(-6)}.${ext}`;
    try {
      await storage.repository.saveReference(workCode, chr.id, fileName, file);
      const refs = chr.references.slice();
      const addedAt = nowIso();
      if (target.kind === 'slot') {
        const old = refs.find((r) => r.slot === target.slot);
        if (old) {
          await storage.repository.deleteReference(workCode, chr.id, old.file).catch(() => undefined);
          forgetRefUrl(workCode, chr.id, old.file);
          old.file = fileName;
          old.addedAt = addedAt;
        } else refs.push({ id, slot: target.slot, name: '', file: fileName, addedAt });
      } else if (target.refId) {
        const old = refs.find((r) => r.id === target.refId);
        if (old) {
          await storage.repository.deleteReference(workCode, chr.id, old.file).catch(() => undefined);
          forgetRefUrl(workCode, chr.id, old.file);
          old.file = fileName;
          old.addedAt = addedAt;
        }
      } else {
        if (refs.filter((r) => !r.slot).length >= MAX_CUSTOM_REFS) {
          setError(`추가 자료는 최대 ${MAX_CUSTOM_REFS}장입니다`);
          return;
        }
        refs.push({ id, slot: null, name: file.name.replace(/\.[^.]+$/, ''), file: fileName, addedAt });
      }
      const mainReference = chr.mainReference && refs.some((r) => r.id === chr.mainReference) ? chr.mainReference : refs[0]?.id;
      update(chr.id, { references: refs, mainReference });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeRef = async (chr: Character, ref: ReferenceImage) => {
    await storage.repository.deleteReference(workCode, chr.id, ref.file).catch(() => undefined);
    forgetRefUrl(workCode, chr.id, ref.file);
    const refs = chr.references.filter((r) => r.id !== ref.id);
    update(chr.id, { references: refs, mainReference: chr.mainReference === ref.id ? refs[0]?.id : chr.mainReference });
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = uploadTarget.current;
    e.target.value = '';
    if (file && target && selected) void upload(selected, file, target);
  };

  const setGender = (chr: Character, gender: Gender | 'other') => {
    const patch: Partial<Character> = { info: { ...chr.info, gender } };
    if (gender !== 'other') {
      const doll = DOLL_ASSETS.find((d) => !d.hidden && d.gender === gender && d.glbPath) ?? DOLL_ASSETS[0];
      patch.dollId = doll.id;
      const cur = DOLL_ASSETS.find((d) => d.id === chr.dollId);
      if (!cur || cur.baseHeightCm === chr.heightCm) patch.heightCm = doll.baseHeightCm;
    }
    update(chr.id, patch);
  };

  const roleOf = (c: Character): CharacterRole => (CHARACTER_ROLES.includes(c.info.role as CharacterRole) ? (c.info.role as CharacterRole) : '조연');
  const sorted = list ? sortCharacters(list) : null;

  return (
    <div className="modal-backdrop" onClick={() => void close()}>
      <div className="modal wide cm" onClick={(e) => e.stopPropagation()}>
        <h2>
          캐릭터 관리 <span className="muted small">작품 {workCode}</span>
          <button className="icon ghost close-x" onClick={() => void close()} title="닫기 (Esc)">
            <Icon name="close" size={16} />
          </button>
        </h2>
        <div className="muted small">캐릭터는 작품에 종속됩니다. 돌에 지정하면 성별 돌·키·고정색이 따라오고, AI 전달 패키지에 설명과 레퍼런스가 실립니다. 고치면 바로 저장됩니다. 목록은 역할 순(주인공 → 조연 → 엑스트라)입니다.</div>
        {error && (
          <div className="small" style={{ color: 'var(--danger)' }}>
            {error}{' '}
            <button className="ghost" onClick={() => setError(null)}>
              닫기
            </button>
          </div>
        )}
        <input ref={fileInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChosen} />
        <div className="cm-layout">
          <div className="cm-list">
            {!list && <div className="muted small">불러오는 중…</div>}
            {sorted?.map((c) => (
              <div key={c.id} className={`cm-item ${c.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(c.id)}>
                <span className="swatch" style={{ background: c.color }} />
                <span className="grow">{c.name || '(이름 없음)'}</span>
                <span className="muted small" title="역할 · 레퍼런스 수">
                  {roleOf(c)} · {c.references.length}
                </span>
              </div>
            ))}
            {list && list.length === 0 && <div className="muted small">등록된 캐릭터가 없습니다.</div>}
            <button className="primary" onClick={() => void add()}>
              <Icon name="plus" /> 새 캐릭터
            </button>
          </div>
          <div className="cm-form">
            {!selected && <div className="placeholder">왼쪽에서 캐릭터를 고르거나 새로 만드세요.</div>}
            {selected && (
              <>
                <div className="field-row">
                  <label>이름</label>
                  <div className="row-wrap">
                    <input type="text" className="grow" value={selected.name} onChange={(e) => update(selected.id, { name: e.target.value })} spellCheck={false} />
                    <select value={roleOf(selected)} onChange={(e) => update(selected.id, { info: { ...selected.info, role: e.target.value } })} title="역할: 에셋 목록 정렬 순서(주인공이 위, 조연, 엑스트라)">
                      {CHARACTER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <label>고정색</label>
                  <div className="row-wrap">
                    {CHARACTER_COLORS.map((c) => (
                      <span key={c.hex} className="swatch big" style={{ background: c.hex, outline: selected.color.toLowerCase() === c.hex.toLowerCase() ? '2px solid var(--text)' : 'none', outlineOffset: 1 }} title={c.name} onClick={() => update(selected.id, { color: c.hex })} />
                    ))}
                    <input type="color" value={selected.color} onChange={(e) => update(selected.id, { color: e.target.value })} title="다른 색" />
                  </div>
                </div>
                <div className="field-row">
                  <label>돌</label>
                  <div className="row-wrap">
                    <select value={selected.info.gender} onChange={(e) => setGender(selected, e.target.value as Gender | 'other')} title="성별(기본 돌이 정해짐)">
                      <option value="male">남</option>
                      <option value="female">여</option>
                      <option value="other">기타</option>
                    </select>
                    <select value={selected.dollId} onChange={(e) => update(selected.id, { dollId: e.target.value })} title="체형(돌 파일)">
                      {DOLL_ASSETS.filter((d) => !d.hidden || d.id === selected.dollId).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <NumberField key={`h-${selected.id}`} value={selected.heightCm} min={50} max={250} width={64} title="키(cm): 입력 뒤 Enter 또는 칸을 벗어나면 반영" onCommit={(v) => v !== undefined && update(selected.id, { heightCm: v })} />
                    <span className="muted small">cm</span>
                    <NumberField key={`a-${selected.id}`} value={selected.info.age} min={0} max={200} width={60} placeholder="나이" allowEmpty title="나이" onCommit={(v) => update(selected.id, { info: { ...selected.info, age: v } })} />
                  </div>
                </div>
                <div className="field-row">
                  <label>한 줄 설명</label>
                  <input type="text" value={selected.info.oneLine ?? ''} onChange={(e) => update(selected.id, { info: { ...selected.info, oneLine: e.target.value } })} placeholder="예: 검술학과 1학년, 무뚝뚝하지만 정이 많다" spellCheck={false} />
                </div>
                <div className="field-row">
                  <label>외형 태그</label>
                  <TagsField key={`t-${selected.id}`} tags={selected.appearanceTags} placeholder="쉼표로 구분: 검은 단발, 교복, 마른 체형" onCommit={(tags) => update(selected.id, { appearanceTags: tags })} />
                </div>
                <div className="field-row top">
                  <label>설명</label>
                  <textarea value={selected.description} onChange={(e) => update(selected.id, { description: e.target.value })} rows={3} placeholder="AI에게 전달할 간략한 설명(성격·배경·특징)" spellCheck={false} />
                </div>

                <h3>레퍼런스 기본 8장 — 비어 있어도 되지만 채울수록 생성 품질이 오릅니다. ★ 대표</h3>
                <div className="refs-grid">
                  {REF_SLOTS.map((slot) => {
                    const ref = selected.references.find((r) => r.slot === slot.id) ?? null;
                    return <RefSlotBox key={slot.id} workCode={workCode} chr={selected} label={slot.label} refImage={ref} onPick={() => pickFile({ kind: 'slot', slot: slot.id })} onDrop={(f) => void upload(selected, f, { kind: 'slot', slot: slot.id })} onRemove={ref ? () => void removeRef(selected, ref) : undefined} onMain={ref ? () => update(selected.id, { mainReference: ref.id }) : undefined} />;
                  })}
                </div>

                <h3>추가 자료(복장·무기 등, 최대 {MAX_CUSTOM_REFS}장) — 이름을 붙여 둡니다</h3>
                <div className="refs-grid">
                  {selected.references
                    .filter((r) => !r.slot)
                    .map((r) => (
                      <RefSlotBox key={r.id} workCode={workCode} chr={selected} label={refLabel(r)} refImage={r} editableName onRename={(name) => update(selected.id, { references: selected.references.map((x) => (x.id === r.id ? { ...x, name } : x)) })} onPick={() => pickFile({ kind: 'custom', refId: r.id })} onDrop={(f) => void upload(selected, f, { kind: 'custom', refId: r.id })} onRemove={() => void removeRef(selected, r)} onMain={() => update(selected.id, { mainReference: r.id })} />
                    ))}
                  {selected.references.filter((r) => !r.slot).length < MAX_CUSTOM_REFS && (
                    <div
                      className="ref-slot add"
                      onClick={() => pickFile({ kind: 'custom' })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) void upload(selected, f, { kind: 'custom' });
                      }}
                    >
                      <Icon name="plus" size={20} />
                      <span className="small">추가 자료</span>
                    </div>
                  )}
                </div>

                <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                  <button className="danger" onClick={() => void remove(selected)}>
                    <Icon name="trash" /> 이 캐릭터 삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => void close()}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function RefSlotBox({
  workCode,
  chr,
  label,
  refImage,
  editableName,
  onRename,
  onPick,
  onDrop,
  onRemove,
  onMain,
}: {
  workCode: string;
  chr: Character;
  label: string;
  refImage: ReferenceImage | null;
  editableName?: boolean;
  onRename?: (name: string) => void;
  onPick: () => void;
  onDrop: (file: File) => void;
  onRemove?: () => void;
  onMain?: () => void;
}) {
  const url = useRefUrl(workCode, chr.id, refImage?.file);
  const isMain = !!refImage && chr.mainReference === refImage.id;
  return (
    <div
      className={`ref-slot ${refImage ? 'filled' : ''}`}
      title={refImage ? `${label} · 클릭: 바꾸기 · 이미지를 끌어다 놓아도 됩니다` : `${label} · 클릭해 이미지 고르기 · 끌어다 놓기`}
      onClick={onPick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onDrop(f);
      }}
    >
      {url ? <img src={url} alt={label} draggable={false} /> : <span className="empty">{refImage ? '…' : <Icon name="upload" size={18} />}</span>}
      {editableName && onRename ? (
        <input className="cap-input" type="text" value={refImage?.name ?? ''} placeholder="항목 이름" onClick={(e) => e.stopPropagation()} onChange={(e) => onRename(e.target.value)} spellCheck={false} />
      ) : (
        <span className="cap">{label}</span>
      )}
      {refImage && onMain && (
        <button className={`star ${isMain ? 'on' : ''}`} title={isMain ? '대표 레퍼런스' : '대표로 지정'} onClick={(e) => (e.stopPropagation(), onMain())}>
          ★
        </button>
      )}
      {refImage && onRemove && (
        <button className="rm" title="지우기" onClick={(e) => (e.stopPropagation(), onRemove())}>
          ×
        </button>
      )}
    </div>
  );
}
