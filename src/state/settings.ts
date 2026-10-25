import { DEFAULT_SITUATION_TAGS } from '../model/library';

/** 5단계 이미지 생성 엔진: 모의(네트워크 없음, 파이프라인 확인용) / 원격(사용자가 배포한 서버리스 함수) */
export type GenEngineKind = 'mock' | 'remote';
/** 강도 프리셋: 돌 우선 / 균형 / 프롬프트 우선 */
export type GenPreset = 'doll' | 'balanced' | 'prompt';
/** 출력 크기: 격자 비율대로(gpt-image-2 계열) / 고정 3종 중 가까운 것(gpt-image-1.5) / API 자동 */
export type GenSizeMode = 'custom' | 'fixed' | 'auto';
export type GenQuality = 'auto' | 'low' | 'medium' | 'high';

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
  /** 손목·발목 방향 고정: IK로 끌 때 손·발의 방향을 유지한다 */
  lockEndOrientation: boolean;
  /** 관절 한계: 사람 관절이 안 가는 각도로 꺾이지 않게 자동 교정 */
  jointLimits: boolean;
  /** 바닥 뚫기 금지: 발(몸)이 바닥 아래로 내려가지 않게 */
  floorLock: boolean;
  /** 몸통 따라가기: 손을 팔 길이 밖으로 끌면 상체가 그쪽으로 기운다 */
  torsoFollow: boolean;
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
  /** 씬 저장 때 버튼으로 찍는 상황 태그 목록(씬 검색기 필터에도 쓰임) */
  situationTags: string[];

  // ---------- 5단계 이미지 생성 ----------
  genEngine: GenEngineKind;
  /** 서버리스 함수 주소(원격 엔진). OpenAI 키가 아니라 함수 URL */
  genEndpoint: string;
  /** 함수 접근 토큰(함수 배포 때 정한 값). OpenAI API 키는 절대 여기 넣지 않는다 */
  genToken: string;
  /** 묶음 상한(4·6·8컷) */
  genMaxPerBatch: number;
  genPreset: GenPreset;
  genSizeMode: GenSizeMode;
  /** 격자 한 칸(컷 하나)의 목표 가로 px */
  genCellPx: number;
  /** 묶음마다 받을 후보 장수(n) */
  genCandidates: number;
  genQuality: GenQuality;
  /** 돌 격자와 함께 선화 격자 첨부 */
  genAttachLine: boolean;
  /** 돌 격자와 함께 색 마스크 격자 첨부 */
  genAttachMask: boolean;
  /** 캐릭터당 첨부할 레퍼런스 장수(대표부터) */
  genRefsPerCharacter: number;
  /** 모든 묶음 프롬프트 끝에 붙는 화풍 문구(선택) */
  genStyle: string;
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
  lockEndOrientation: false,
  jointLimits: true,
  floorLock: true,
  torsoFollow: true,
  undoLimit: 200,
  autosaveSeconds: 60,
  showFrustum: true,
  showGrid: true,
  manuscriptGrid: true,
  theme: 'light',
  showHints: false,
  situationTags: [...DEFAULT_SITUATION_TAGS],
  genEngine: 'mock',
  genEndpoint: '',
  genToken: '',
  genMaxPerBatch: 4,
  genPreset: 'balanced',
  genSizeMode: 'custom',
  genCellPx: 1024,
  genCandidates: 1,
  genQuality: 'auto',
  genAttachLine: false,
  genAttachMask: false,
  genRefsPerCharacter: 1,
  genStyle: '',
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
