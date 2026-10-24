/** 조작감 관련 설정. 실제 작업으로 맞춰 가도록 모두 바꿀 수 있다 */
export interface Settings {
  /** 시점 조작 방식: 스케치업(휠 드래그 회전, Shift+휠 팬) / 디자인돌(우클릭 회전, 휠 드래그 팬) */
  orbitMode: 'sketchup' | 'designdoll';
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  /** 기즈모 크기 배율 */
  gizmoSize: number;
  /** IK 핸들 크기 배율 */
  handleSize: number;
  /** 어깨 연동: 손을 끌면 쇄골이 조금 따라온다 */
  shoulderLink: boolean;
  /** 어깨 연동 비율(0~0.6) */
  shoulderLinkRatio: number;
  /** 직접 드래그 감도(픽셀 → 회전) */
  directDragSpeed: number;
  /** 발 고정: 돌 전체를 옮길 때 발이 바닥 위치를 지킨다(다리 IK) */
  plantFeet: boolean;
  /** 손목·발목 방향 고정: IK로 끌 때 손·발의 방향을 유지한다 */
  lockEndOrientation: boolean;
  /** 관절 한계: 사람 관절이 안 가는 각도로 꺾이지 않게 자동 교정 */
  jointLimits: boolean;
  undoLimit: number;
  autosaveSeconds: number;
  /** 조작뷰에 원고 카메라 화각 범위 표시 */
  showFrustum: boolean;
  showGrid: boolean;
  /** 원고뷰에도 바닥 격자 표시(출력에는 안 들어감) */
  manuscriptGrid: boolean;
  theme: 'light' | 'dark';
  /** 조작뷰 구석의 조작 안내 상자 */
  showHints: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  orbitMode: 'sketchup',
  rotateSpeed: 1,
  zoomSpeed: 1,
  panSpeed: 1,
  gizmoSize: 1,
  handleSize: 1,
  shoulderLink: true,
  shoulderLinkRatio: 0.25,
  directDragSpeed: 1,
  plantFeet: false,
  lockEndOrientation: false,
  jointLimits: true,
  undoLimit: 200,
  autosaveSeconds: 60,
  showFrustum: true,
  showGrid: true,
  manuscriptGrid: true,
  theme: 'light',
  showHints: false,
};

const KEY = 'scene-doll.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 불가 환경이면 무시 */
  }
}
