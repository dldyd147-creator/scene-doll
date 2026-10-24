import { useStore } from '../state/store';

const ROWS: Array<[string, string]> = [
  ['몸 부위 드래그', '그 관절이 바로 회전 (Alt: 뼈 축 비틀기)'],
  ['관절점(작은 원) 드래그', '그 관절이 커서를 따라가도록 위 뼈를 돌림'],
  ['손·발 핸들(큰 원) 드래그', 'IK로 팔·다리 전체가 따라옴'],
  ['골반 핸들(사각) / 골반 드래그', '돌 이동 · Shift: 높이 · Alt: 돌 전체 회전'],
  ['바닥 링 드래그', '돌 전체 회전'],
  ['Q / W / E', '직접 드래그 / 이동 기즈모 / 회전 링 기즈모'],
  ['휠 드래그 / Shift+휠 드래그 / 휠', '시점 회전 / 팬 / 줌 (스케치업) — 설정에서 디자인돌식(우클릭 회전) 선택'],
  ['Shift+Z / F / Tab', '전체 보기 / 선택 돌로 / 조작뷰 ↔ 원고 카메라 시점'],
  ['원고뷰 드래그 / Shift+드래그 / 휠 / Ctrl+휠', '원고 카메라 궤도 회전 / 팬 / 거리 / 화각'],
  ['Ctrl+Enter', '컷 확정 → 다음 컷(없으면 복사해 생성)'],
  ['PageUp / PageDown', '위 컷 / 아래 컷'],
  ['Ctrl+Z / Ctrl+Y', '되돌리기 / 다시하기 (컷을 옮기면 비워짐)'],
  ['Ctrl+C / Ctrl+V / Delete', '돌 복사 / 같은 자리에 붙여넣기 / 삭제'],
  ['Ctrl+S', '저장 (컷 확정마다, 1분마다 자동 저장)'],
  ['Esc', '기즈모 모드 해제 → 선택 해제'],
];

export function HelpDialog() {
  const open = useStore((s) => s.helpOpen);
  const setOpen = useStore((s) => s.setHelpOpen);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>도움말</h2>
        <h3>작업 흐름</h3>
        <ol className="help-flow">
          <li>에셋 패널 돌 탭에서 + 를 눌러 돌을 꺼내고, 조작뷰에서 자세를 잡는다.</li>
          <li>원고뷰에서 카메라를 잡는다(드래그·휠). 카메라 패널의 숫자는 끌어서 조절한다.</li>
          <li>Ctrl+Enter로 컷을 확정하면 설명 텍스트와 썸네일이 생기고 다음 컷으로 넘어간다.</li>
          <li>컷 목록의 출력 버튼으로 확정 컷을 PNG + 설명 텍스트로 내보낸다. 결과는 출력물 보기에서 확인한다.</li>
        </ol>
        <h3>조작</h3>
        <table className="help-table">
          <tbody>
            {ROWS.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>저장 위치</h3>
        <div className="small">
          작업 폴더를 지정하면 <code>작품/작품코드/회차/001/컷/</code>에 컷 JSON, <code>썸네일/</code>에 PNG, <code>출력/작품코드/001/</code>에 출력물이 생깁니다. 브라우저는 보안상 탐색기를 직접 열 수 없어, 출력물은 앱 안의 출력물 보기로 확인하고 폴더는 탐색기에서 같은 이름으로 찾습니다.
        </div>
        <div className="actions">
          <button className="primary" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
