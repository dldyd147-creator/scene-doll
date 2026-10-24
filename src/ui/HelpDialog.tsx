import { useStore } from '../state/store';

const ROWS: Array<[string, string]> = [
  ['G (또는 M)', '선택한 돌·카메라 이동(블렌더식): 마우스를 움직이면 따라오고 클릭·Enter로 확정, Esc·우클릭 취소. X/Y/Z로 축 고정(Z가 위아래, Y가 앞뒤). 자세는 바뀌지 않음'],
  ['R', '선택한 돌·카메라 회전(기본 위아래축 둘레). X/Y/Z로 축 고정, 클릭·Enter 확정. 돌 회전은 R과 회전 기즈모(E)로만 하고 자세는 바뀌지 않음'],
  ['Alt+G / Alt+R', '선택한 돌의 위치를 원점으로 / 회전을 정면으로 초기화. 툴바의 전체 초기화는 위치·회전·자세를 한 번에'],
  ['골반 드래그', '골반(엉덩이)을 잡으면 돌이 선택되고, 끌면 발을 바닥에 둔 채 몸통이 따라옴. 아래로 끌면 무릎이 굽어 앉고, 위로 끌면 돌이 들림. 회전하지 않음'],
  ['몸 부위 드래그', '그 관절이 바로 회전 (Alt: 뼈 축 비틀기)'],
  ['관절점(작은 원) 드래그', '그 관절이 커서를 따라가도록 위 뼈를 돌림. 팔다리 점은 몸 뒤에 가려지면 숨고, 몸통 점(머리·목·가슴·명치·허리·골반)은 항상 보임'],
  ['손·발 핸들(큰 원) 드래그', 'IK로 팔·다리 전체가 따라옴. 바닥 아래로는 내려가지 않음'],
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
