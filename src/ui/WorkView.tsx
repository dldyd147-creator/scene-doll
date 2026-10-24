import { useCallback } from 'react';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';
import { Icon } from './icons';

export function WorkView({ engine }: { engine: Engine }) {
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
  const hasDoll = !!selection.dollId;

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

  return (
    <section className="view work-view">
      <div className="view-surface" ref={surfaceRef} />
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
          <button className="icon" disabled={!hasDoll} onClick={() => engine.fixJoints()} title="관절을 사람 관절 한계 안으로 교정">
            <Icon name="fix" />
          </button>
          <button className="icon" disabled={!hasDoll} onClick={() => engine.snapSelectedToGround()} title="가장 낮은 점을 바닥에 붙이기">
            <Icon name="ground" />
          </button>
          <button className="icon" disabled={!hasDoll} onClick={() => selection.dollId && duplicateDoll(selection.dollId)} title="복제 (Ctrl+C · Ctrl+V는 같은 자리)">
            <Icon name="copy" />
          </button>
          <button className="icon danger" disabled={!hasDoll} onClick={() => selection.dollId && removeDoll(selection.dollId)} title="삭제 (Delete)">
            <Icon name="trash" />
          </button>
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
