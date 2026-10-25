import { useEffect, useState } from 'react';
import { PRESET_ORDER, PRESETS } from '../generate/batch';
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

/** 문자열·숫자 선택지 한 줄 */
function Seg<T extends string | number>({ label, value, options, labels, onChange, title }: { label: string; value: T; options: readonly T[]; labels?: Partial<Record<string, string>>; onChange: (v: T) => void; title?: string }) {
  return (
    <div className="setting" title={title}>
      <span>{label}</span>
      <span className="segmented">
        {options.map((o) => (
          <button key={String(o)} className={o === value ? 'active' : ''} onClick={() => onChange(o)}>
            {labels?.[String(o)] ?? String(o)}
          </button>
        ))}
      </span>
      <span />
    </div>
  );
}

function TextSetting({ label, k, placeholder, type = 'text', title }: { label: string; k: 'genEndpoint' | 'genToken' | 'genStyle'; placeholder?: string; type?: 'text' | 'password'; title?: string }) {
  const value = useStore((s) => s.settings[k]);
  const update = useStore((s) => s.updateSettings);
  return (
    <div className="setting">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} spellCheck={false} autoComplete="off" title={title} onChange={(e) => update({ [k]: e.target.value } as Partial<Settings>)} />
      <span />
    </div>
  );
}

/** 5단계 이미지 생성 설정. API 키는 여기 없다(서버리스 함수의 환경 변수) */
function GenerateSettings() {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  return (
    <>
      <Seg label="엔진" value={s.genEngine} options={['mock', 'remote'] as const} labels={{ mock: '모의', remote: '원격(함수)' }} onChange={(v) => update({ genEngine: v })} title="모의: 네트워크 없이 돌 격자에 MOCK 표시를 얹어 돌려줌(흐름 확인용). 원격: 아래 주소의 서버리스 함수가 OpenAI Images API를 호출" />
      {s.genEngine === 'remote' && (
        <>
          <TextSetting label="함수 주소(엔드포인트)" k="genEndpoint" placeholder="https://scene-doll-image.<계정>.workers.dev/" title="serverless/openai-image 를 배포한 URL" />
          <TextSetting label="함수 접근 토큰" k="genToken" type="password" placeholder="함수 배포 때 정한 ACCESS_TOKEN" title="함수의 ACCESS_TOKEN 비밀값과 같은 문자열. OpenAI 키가 아님" />
        </>
      )}
      <div className="small muted">OpenAI API 키는 브라우저에 두지 않습니다. 키는 서버리스 함수(저장소의 serverless/openai-image, Cloudflare Worker 또는 Vercel)의 환경 변수에만 넣고, 여기에는 그 함수의 주소와 접근 토큰만 넣습니다(이 브라우저의 설정에 저장됨).</div>
      <Seg label="묶음 상한" value={s.genMaxPerBatch} options={[4, 6, 8] as const} labels={{ 4: '4컷', 6: '6컷', 8: '8컷' }} onChange={(v) => update({ genMaxPerBatch: v })} title="한 번에 격자로 묶어 보내는 컷 수. 같은 묶음 태그끼리 묶이고 넘치면 균등 분할" />
      <Seg label="기본 강도 프리셋" value={s.genPreset} options={PRESET_ORDER} labels={{ doll: PRESETS.doll.label, balanced: PRESETS.balanced.label, prompt: PRESETS.prompt.label }} onChange={(v) => update({ genPreset: v })} title={PRESET_ORDER.map((p) => `${PRESETS[p].label}: ${PRESETS[p].short}`).join('\n')} />
      <Seg label="출력 크기" value={s.genSizeMode} options={['custom', 'fixed', 'auto'] as const} labels={{ custom: '격자 비율', fixed: '고정 3종', auto: '자동' }} onChange={(v) => update({ genSizeMode: v })} title="격자 비율: 격자 크기 그대로 16의 배수·픽셀 상한 안으로(gpt-image-2 계열). 고정 3종: 1024×1024·1024×1536·1536×1024 중 가까운 것(gpt-image-1.5). 자동: API가 정함" />
      <Seg label="칸(컷) 가로 px" value={s.genCellPx} options={[512, 768, 1024] as const} onChange={(v) => update({ genCellPx: v })} title="격자 한 칸(컷 하나)의 가로 픽셀. 클수록 비용·시간이 늘고 선명해짐" />
      <Seg label="품질" value={s.genQuality} options={['auto', 'low', 'medium', 'high'] as const} onChange={(v) => update({ genQuality: v })} title="API quality. 토큰(비용)은 품질·크기에 비례" />
      <Range label="후보 장수(묶음마다)" k="genCandidates" min={1} max={4} step={1} />
      <Range label="캐릭터당 레퍼런스 장수" k="genRefsPerCharacter" min={1} max={3} step={1} />
      <Toggle label="선화 격자 첨부" k="genAttachLine" />
      <Toggle label="색 마스크 격자 첨부" k="genAttachMask" />
      <TextSetting label="화풍 문구(프롬프트 끝)" k="genStyle" placeholder="예: 흑백 웹툰 선화, 깔끔한 펜선, 스크린톤" />
    </>
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

        <h3>이미지 생성(5단계)</h3>
        <GenerateSettings />

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
