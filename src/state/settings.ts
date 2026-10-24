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
  undoLimit: number;
  autosaveSeconds: number;
  /** 조작뷰에 원고 카메라 화각 범위 표시 */
  showFrustum: boolean;
  showGrid: boolean;
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
  undoLimit: 200,
  autosaveSeconds: 60,
  showFrustum: true,
  showGrid: true,
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
