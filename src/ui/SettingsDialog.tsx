import { useEffect, useState } from 'react';
import { DEFAULT_SITUATION_TAGS, parseTagList } from '../model/library';
import { useStore } from '../state/store';
import type { Settings } from '../state/settings';

function Range({ label, k, min, max, step, fmt }: { label: string; k: keyof Settings; min: number; max: number; step: number; fmt?: (v: number) => string }) {
  const value = useStore((s) => s.settings[k]) as number;
  const update = useStore((s) => s.updateSettings);
  return (
    <div className="setting">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => update({ [k]: Number(e.target.value) } as Partial<Settings>)} />
      <span className="val">{fmt ? fmt(value) : value}</span>
    </div>
  );
}

function Toggle({ label, k }: { label: string; k: keyof Settings }) {
  const value = useStore((s) => s.settings[k]) as boolean;
  const update = useStore((s) => s.updateSettings);
  return (
    <div className="setting">
      <span>{label}</span>
      <span>
        <button className={value ? 'active' : ''} onClick={() => update({ [k]: !value } as Partial<Settings>)}>
          {value ? '켬' : '끔'}
        </button>
      </span>
      <span />
    </div>
  );
}

/** 씬 저장 때 찍는 상황 태그 버튼 목록(쉼표로 구분). 비우면 기본 10개로 돌아간다 */
function SituationTagsSetting() {
  const tags = useStore((s) => s.settings.situationTags);
  const update = useStore((s) => s.updateSettings);
  const [text, setText] = useState(tags.join(', '));
  useEffect(() => setText(tags.join(', ')), [tags]);
  const commit = () => {
    const list = parseTagList(text);
    update({ situationTags: list.length ? list : [...DEFAULT_SITUATION_TAGS] });
  };
  return (
    <div className="setting">
      <span>상황 태그 버튼(쉼표로 구분)</span>
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} spellCheck={false} title="씬 저장 대화상자와 씬 검색기 필터에 나오는 상황 태그 버튼. 비우면 기본 10개" />
      <span />
    </div>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const orbitMode = useStore((s) => s.settings.orbitMode);
  const theme = useStore((s) => s.settings.theme);
  const update = useStore((s) => s.updateSettings);
  const reset = useStore((s) => s.resetSettings);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>설정</h2>

        <h3>화면</h3>
        <div className="setting">
          <span>테마</span>
          <span className="segmented">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => update({ theme: 'light' })}>
              밝게
            </button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => update({ theme: 'dark' })}>
              어둡게
            </button>
          </span>
          <span />
        </div>
        <Toggle label="조작뷰 바닥 격자" k="showGrid" />
        <Toggle label="원고뷰에도 바닥 격자(출력 제외)" k="manuscriptGrid" />
        <Toggle label="원고 카메라 화각선" k="showFrustum" />
        <Toggle label="조작뷰 조작 안내 상자" k="showHints" />

        <h3>시점 조작</h3>
        <div className="setting">
          <span>방식</span>
          <span className="segmented">
            <button className={orbitMode === 'sketchup' ? 'active' : ''} onClick={() => update({ orbitMode: 'sketchup' })}>
              스케치업 (휠 드래그 회전)
            </button>
            <button className={orbitMode === 'designdoll' ? 'active' : ''} onClick={() => update({ orbitMode: 'designdoll' })}>
              디자인돌 (우클릭 회전)
            </button>
          </span>
          <span />
        </div>
        <Range label="회전 감도" k="rotateSpeed" min={0.3} max={3} step={0.1} />
        <Range label="줌 감도" k="zoomSpeed" min={0.3} max={3} step={0.1} />
        <Range label="팬 감도" k="panSpeed" min={0.3} max={3} step={0.1} />

        <h3>포징</h3>
        <Toggle label="관절 한계(자동 교정)" k="jointLimits" />
        <Toggle label="바닥 뚫기 금지(발·몸이 바닥 아래로 안 감)" k="floorLock" />
        <Toggle label="몸통 따라가기(손을 멀리 끌면 상체가 기움)" k="torsoFollow" />
        <Toggle label="어깨 연동(손 끌 때 쇄골 따라옴)" k="shoulderLink" />
        <Range label="어깨 연동 비율" k="shoulderLinkRatio" min={0} max={0.6} step={0.05} fmt={(v) => v.toFixed(2)} />
        <Toggle label="손·발 방향 고정(IK 때)" k="lockEndOrientation" />
        <Range label="직접 드래그 감도" k="directDragSpeed" min={0.3} max={2} step={0.1} />
        <Range label="기즈모 크기" k="gizmoSize" min={0.5} max={2} step={0.1} />
        <Range label="제어점 크기" k="handleSize" min={0.6} max={2.5} step={0.1} />

        <h3>씬 라이브러리</h3>
        <SituationTagsSetting />

        <h3>저장</h3>
        <Range label="되돌리기 최대 단계" k="undoLimit" min={100} max={1000} step={50} />
        <Range label="자동 저장 간격(초)" k="autosaveSeconds" min={15} max={600} step={15} />

        <div className="actions">
          <button onClick={reset}>기본값으로</button>
          <button className="primary" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
