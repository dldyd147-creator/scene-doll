import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Engine } from '../engine/Engine';
import { propRestHeight } from '../engine/props';
import { IK_CHAINS } from '../engine/skeleton';
import { gripFor } from '../model/props';
import type { Vec3 } from '../model/types';
import { useStore } from '../state/store';
import { dragPayload, endDrag, isSceneDollDrag } from './dragdrop';
import { DragNumber } from './DragNumber';
import { Icon } from './icons';
import { useLibrary } from './library';

const clampFloor = (v: number): number => Math.max(-50, Math.min(50, Math.round(v * 100) / 100));

export function WorkView({ engine }: { engine: Engine }) {
  const [dropHover, setDropHover] = useState(false);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const selection = useStore((s) => s.selection);
  const dollCount = useStore((s) => s.cuts[s.currentCutIndex].dolls.length);
  const shading = useStore((s) => s.cuts[s.currentCutIndex].light.shading);
  const crosshair = useStore((s) => s.cuts[s.currentCutIndex].crosshair);
  const outline = useStore((s) => s.cuts[s.currentCutIndex].outline);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const commitCut = useStore((s) => s.commitCut);
  const removeDoll = useStore((s) => s.removeDoll);
  const duplicateDoll = useStore((s) => s.duplicateDoll);
  const removeProp = useStore((s) => s.removeProp);
  const duplicateProp = useStore((s) => s.duplicateProp);
  const setHandOperator = useStore((s) => s.setHandOperator);
  const hasDoll = !!selection.dollId;
  const hasProp = !!selection.propId;
  const duplicateSelected = () => (selection.propId ? duplicateProp(selection.propId) : selection.dollId ? duplicateDoll(selection.dollId) : null);
  const removeSelected = () => (selection.propId ? removeProp(selection.propId) : selection.dollId ? removeDoll(selection.dollId) : undefined);

  // 팔꿈치·무릎 방향 다이얼: 선택한 뼈가 팔·다리 사슬에 들면 보인다. 상대값(끌면 그만큼 돈다)
  const limbKind = useMemo(() => {
    const b = selection.bone;
    if (!b) return null;
    for (const key of Object.keys(IK_CHAINS)) {
      const c = IK_CHAINS[key];
      if (c.upper === b || c.lower === b || c.end === b) return key.endsWith('Hand') ? 'arm' : 'leg';
    }
    return null;
  }, [selection.bone]);
  const [swivel, setSwivel] = useState(0);
  const swivelRef = useRef(0);
  useEffect(() => {
    setSwivel(0);
    swivelRef.current = 0;
  }, [selection.dollId, selection.bone]);
  const swivelPreview = (v: number) => {
    const d = v - swivelRef.current;
    swivelRef.current = v;
    setSwivel(v);
    if (d !== 0) engine.swivelSelectedLimb((d * Math.PI) / 180);
  };
  const swivelCommit = (v: number) => {
    swivelPreview(v);
    engine.commitSelectedDoll();
  };
  const surfaceRef = useCallback(
    (el: HTMLDivElement | null) => {
      engine.setViewElement('work', el);
      engine.setWorkSurface(el);
    },
    [engine],
  );

  const toggleCut = (key: 'shading' | 'crosshair' | 'outline') =>
    commitCut((c) => {
      if (key === 'shading') c.light.shading = !c.light.shading;
      else c[key] = !c[key];
    });

  // 에셋 패널에서 끌어다 놓기: 캐릭터·기본 돌은 놓은 자리(바닥)에 세우고, 포즈는 놓은 돌(없으면 선택한 돌)에 적용
  const onDragOver = (e: DragEvent) => {
    if (!isSceneDollDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropHover) setDropHover(true);
  };
  const onDrop = (e: DragEvent) => {
    const payload = dragPayload(e);
    setDropHover(false);
    if (!payload) return;
    e.preventDefault();
    endDrag();
    const s = useStore.getState();
    const { rig, floor } = engine.pickAt(e.clientX, e.clientY);
    const at: Vec3 | undefined = floor ? [clampFloor(floor.x), 0, clampFloor(floor.z)] : undefined;
    if (payload.kind === 'character') {
      const chr = s.characters.find((c) => c.id === payload.id);
      if (s.addCharacterDoll(payload.id, at)) s.setStatusHint(`${chr?.name ?? '캐릭터'}의 돌을 놓았습니다`);
      return;
    }
    if (payload.kind === 'doll') {
      s.addDoll(payload.dollId, payload.heightCm, at);
      s.setStatusHint('기본 돌을 놓았습니다(임시 캐릭터)');
      return;
    }
    if (payload.kind === 'prop') {
      const asset = useLibrary.getState().props?.find((p) => p.id === payload.id);
      if (!asset) return;
      if (rig) {
        const id = s.addProp(asset.id);
        s.attachProp(id, rig.id, 'right', gripFor(asset, 'right'));
        engine.applyFingerPreset('right', 'grip', rig.id);
        const chr = s.characters.find((c) => c.id === s.currentCut().dolls.find((d) => d.id === rig.id)?.characterId);
        s.setStatusHint(`${asset.name}을(를) ${chr?.name ?? '돌'}의 오른손에 쥐어 주었습니다 · 끌거나 G/R로 쥐는 위치를 맞추세요`);
      } else {
        s.addProp(asset.id, at ? [at[0], propRestHeight(asset), at[2]] : undefined);
        s.setStatusHint(`${asset.name}을(를) 놓았습니다`);
      }
      return;
    }
    const pose = useLibrary.getState().poses?.find((p) => p.id === payload.id);
    if (!pose) return;
    const target = rig ?? engine.selectedRig();
    if (!target) {
      s.setStatusHint('포즈는 돌 위에 놓거나, 돌을 먼저 선택한 뒤 놓으세요');
      return;
    }
    if (rig) s.select({ dollId: rig.id, bone: null });
    engine.applyPoseToDoll(target.id, pose.joints);
    s.setStatusHint(`포즈 '${pose.name}' 적용 (Ctrl+Z로 되돌림)`);
  };

  return (
    <section className={`view work-view ${dropHover ? 'drop-hover' : ''}`}>
      <div className="view-surface" ref={surfaceRef} onDragOver={onDragOver} onDragLeave={() => setDropHover(false)} onDrop={onDrop} />
      {dollCount === 0 && (
        <div className="work-empty">
          <div>
            오른쪽 <b>돌</b> 탭에서 <Icon name="plus" size={14} /> 를 눌러 돌을 꺼내세요.
          </div>
        </div>
      )}
      <div className="work-toolbar">
        <div className="group" title="조작 모드">
          <button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')} title="직접 드래그 (Q): 부위·관절점·핸들을 끌어 자세를 잡음">
            <Icon name="hand" /> 직접
          </button>
          <button className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')} title="이동 기즈모 (W): 돌 전체 또는 손·발 IK 축 이동">
            <Icon name="move" /> 이동
          </button>
          <button className={mode === 'rotate' ? 'active' : ''} onClick={() => setMode('rotate')} title="회전 링 기즈모 (E): 선택 관절 또는 돌 전체">
            <Icon name="rotate" /> 회전
          </button>
        </div>
        <div className="group" title="선택한 돌">
          <button className="icon" disabled={!hasDoll} onClick={() => engine.mirrorSelected()} title="포즈 좌우 반전">
            <Icon name="mirror" />
          </button>
          <button className="icon" disabled={!hasDoll} onClick={() => engine.resetSelectedJoint(true)} title={selection.bone ? '선택한 관절과 그 아래 초기화' : '모든 관절 초기화(T포즈)'}>
            <Icon name="reset" />
          </button>
          <button className="icon" disabled={!hasDoll} onClick={() => engine.resetSelectedDoll('all')} title="돌 전체 초기화: 위치 원점·회전 정면·자세 T포즈 (Alt+G: 위치만, Alt+R: 회전만)">
            <Icon name="resetAll" />
          </button>
          <button className="icon" disabled={!hasDoll} onClick={() => setHandOperator(true)} title="핸드 오퍼레이터: 선택한 돌의 왼손·오른손 손가락 모양(손 확대 보기·손가락별 슬라이더·프리셋 저장/불러오기)">
            <Icon name="fingers" />
          </button>
          <button className="icon" disabled={!hasDoll} onClick={() => engine.fixJoints()} title="관절을 사람 관절 한계 안으로 교정">
            <Icon name="fix" />
          </button>
          <button className="icon" disabled={!hasDoll} onClick={() => engine.snapSelectedToGround()} title="가장 낮은 점을 바닥에 붙이기">
            <Icon name="ground" />
          </button>
          <button className="icon" disabled={!hasDoll && !hasProp} onClick={() => duplicateSelected()} title="선택한 돌·소품 복제 (Ctrl+C · Ctrl+V는 같은 자리)">
            <Icon name="copy" />
          </button>
          <button className="icon danger" disabled={!hasDoll && !hasProp} onClick={() => removeSelected()} title="선택한 돌·소품 삭제 (Delete)">
            <Icon name="trash" />
          </button>
          {limbKind && (
            <DragNumber
              value={swivel}
              step={1}
              digits={0}
              unit={limbKind === 'arm' ? '팔꿈치°' : '무릎°'}
              width={86}
              onPreview={swivelPreview}
              onChange={swivelCommit}
              title={`${limbKind === 'arm' ? '팔꿈치' : '무릎'} 방향: 끌면 손(발)은 그대로 두고 ${limbKind === 'arm' ? '팔꿈치' : '무릎'}가 어깨(고관절)→손(발) 축 둘레로 돕니다`}
            />
          )}
        </div>
        <div className="group" title="시점">
          <button className="icon" onClick={() => engine.fitAll()} title="전체 보기 (Shift+Z)">
            <Icon name="fitAll" />
          </button>
          <button className="icon" onClick={() => engine.focusSelected()} title="선택한 돌로 시점 맞춤 (F)">
            <Icon name="focus" />
          </button>
          <button className="icon" onClick={() => engine.toggleViewWithManuscript()} title="조작뷰 시점 ↔ 원고 카메라 시점 (Tab)">
            <Icon name="camera" />
          </button>
        </div>
        <div className="group" title="표시">
          <button className={`icon ${shading ? 'active' : ''}`} onClick={() => toggleCut('shading')} title="2단 셀 명암(컷에 저장)">
            <Icon name="shading" />
          </button>
          <button className={`icon ${crosshair ? 'active' : ''}`} onClick={() => toggleCut('crosshair')} title="십자선: 얼굴 중심선·눈높이선·몸통 정중선(컷에 저장, 출력 포함)">
            <Icon name="crosshair" />
          </button>
          <button className={`icon ${outline ? 'active' : ''}`} onClick={() => toggleCut('outline')} title="실루엣 외곽선(컷에 저장)">
            <Icon name="outline" />
          </button>
          <button className={`icon ${settings.showGrid ? 'active' : ''}`} onClick={() => updateSettings({ showGrid: !settings.showGrid })} title="바닥 격자">
            <Icon name="grid" />
          </button>
          <button className={`icon ${settings.showFrustum ? 'active' : ''}`} onClick={() => updateSettings({ showFrustum: !settings.showFrustum })} title="원고 카메라 화각 범위 선">
            <Icon name="frustum" />
          </button>
        </div>
        <div className="group" title="포징 보조">
          <button className={`icon ${settings.jointLimits ? 'active' : ''}`} onClick={() => updateSettings({ jointLimits: !settings.jointLimits })} title="관절 한계: 사람 관절이 안 가는 각도로 꺾이지 않게 자동 교정">
            <Icon name="limits" />
          </button>
          <button className={`icon ${settings.shoulderLink ? 'active' : ''}`} onClick={() => updateSettings({ shoulderLink: !settings.shoulderLink })} title="어깨 연동: 손을 끌 때 쇄골이 조금 따라옴">
            <Icon name="shoulder" />
          </button>
          <button className={`icon ${settings.lockEndOrientation ? 'active' : ''}`} onClick={() => updateSettings({ lockEndOrientation: !settings.lockEndOrientation })} title="손·발 방향 고정: IK로 끌 때 손·발 방향 유지">
            <Icon name="wrist" />
          </button>
          <button className={`icon ${settings.torsoFollow ? 'active' : ''}`} onClick={() => updateSettings({ torsoFollow: !settings.torsoFollow })} title="몸통 따라가기: 손을 팔 길이 밖으로 끌면 상체가 그쪽으로 기움(최대 45°)">
            <Icon name="torso" />
          </button>
        </div>
      </div>
      {settings.showHints && (
        <div className="work-hints">
          G: 돌 이동 · R: 돌 회전(X/Y/Z 축 고정, Z가 위아래. 자세는 그대로) · 골반 드래그: 발 고정 몸통 이동(앉기) · 부위 드래그: 관절 회전 · 관절점 드래그: 관절 이동 · 손발 핸들: IK · Alt+부위: 비틀기 · Alt+G/Alt+R: 위치/회전 초기화
          <br />
          {settings.orbitMode === 'designdoll' ? '우클릭 드래그: 시점 회전 · 휠 드래그: 팬' : '휠 드래그: 시점 회전 · Shift+휠 드래그: 팬 · 우클릭 드래그: 팬'} · 휠: 줌 · Ctrl+Z/Y: 되돌리기/다시
        </div>
      )}
    </section>
  );
}
