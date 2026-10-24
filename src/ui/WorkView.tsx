import { useCallback } from 'react';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';

export function WorkView({ engine }: { engine: Engine }) {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const selection = useStore((s) => s.selection);
  const dollCount = useStore((s) => s.cuts[s.currentCutIndex].dolls.length);
  const shading = useStore((s) => s.cuts[s.currentCutIndex].light.shading);
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

  return (
    <section className="view work-view">
      <div className="view-surface" ref={surfaceRef} />
      {dollCount === 0 && (
        <div className="work-empty">
          <div>
            오른쪽 에셋 패널의 <b>돌</b> 탭에서 돌을 추가하세요.
            <br />
            <span className="small">몸 부위를 잡고 끌면 관절이 돌고, 손·발의 회색 핸들을 끌면 팔·다리 전체가 따라옵니다.</span>
          </div>
        </div>
      )}
      <div className="work-toolbar">
        <div className="group" title="조작 모드">
          <button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')} title="부위를 직접 끌어 관절 회전">
            직접<kbd>Q</kbd>
          </button>
          <button className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')} title="이동 기즈모(돌 전체 / 손·발 IK 축 이동)">
            이동<kbd>W</kbd>
          </button>
          <button className={mode === 'rotate' ? 'active' : ''} onClick={() => setMode('rotate')} title="회전 링 기즈모(선택 관절 / 돌 전체)">
            회전<kbd>E</kbd>
          </button>
        </div>
        <div className="group" title="선택한 돌">
          <button disabled={!hasDoll} onClick={() => engine.mirrorSelected()} title="포즈 좌우 반전">
            미러
          </button>
          <button disabled={!hasDoll} onClick={() => engine.resetSelectedJoint(true)} title={selection.bone ? '선택한 관절과 그 아래 관절 초기화' : '모든 관절 초기화'}>
            {selection.bone ? '관절 초기화' : '포즈 초기화'}
          </button>
          <button disabled={!hasDoll || !selection.bone} onClick={() => engine.resetAllJoints()} title="모든 관절 초기화(T포즈)">
            전체 초기화
          </button>
          <button disabled={!hasDoll} onClick={() => engine.snapSelectedToGround()} title="가장 낮은 점을 바닥에 붙이기">
            바닥 접지
          </button>
          <button disabled={!hasDoll} onClick={() => selection.dollId && duplicateDoll(selection.dollId)} title="복제 (Ctrl+C, Ctrl+V는 같은 자리)">
            복제
          </button>
          <button className="danger" disabled={!hasDoll} onClick={() => selection.dollId && removeDoll(selection.dollId)} title="삭제 (Delete)">
            삭제
          </button>
        </div>
        <div className="group" title="시점">
          <button onClick={() => engine.fitAll()} title="모든 돌이 보이는 객관 뷰">
            전체<kbd>Shift+Z</kbd>
          </button>
          <button onClick={() => engine.focusSelected()} title="선택한 돌로 시점 맞춤">
            선택<kbd>F</kbd>
          </button>
          <button onClick={() => engine.toggleViewWithManuscript()} title="조작뷰 시점 ↔ 원고 카메라 시점">
            원고 시점<kbd>Tab</kbd>
          </button>
        </div>
        <div className="group" title="표시">
          <button
            className={shading ? 'active' : ''}
            onClick={() =>
              commitCut((c) => {
                c.light.shading = !c.light.shading;
              })
            }
            title="2단 셀 명암 켜기/끄기(컷에 저장)"
          >
            명암
          </button>
          <button className={settings.showGrid ? 'active' : ''} onClick={() => updateSettings({ showGrid: !settings.showGrid })} title="바닥 격자">
            격자
          </button>
          <button className={settings.showFrustum ? 'active' : ''} onClick={() => updateSettings({ showFrustum: !settings.showFrustum })} title="원고 카메라 화각 범위 선">
            화각선
          </button>
          <button className={settings.shoulderLink ? 'active' : ''} onClick={() => updateSettings({ shoulderLink: !settings.shoulderLink })} title="손을 끌 때 어깨(쇄골)가 조금 따라옴">
            어깨 연동
          </button>
        </div>
      </div>
      <div className="work-hints">
        부위 드래그: 관절 회전 · Alt+드래그: 비틀기 · 손·발 핸들 드래그: IK · 빈 곳 클릭: 선택 해제
        <br />
        {settings.orbitMode === 'designdoll' ? '우클릭 드래그: 시점 회전 · 휠 드래그: 팬' : '휠 드래그: 시점 회전 · Shift+휠 드래그: 팬 · 우클릭 드래그: 팬'} · 휠: 줌 · Ctrl+Z/Y: 되돌리기/다시
      </div>
    </section>
  );
}
