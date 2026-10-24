// 씬 돌 데이터 구조.
// 기획서 '데이터 구조와 폴더 구조'의 8종(작품·회차·컷·캐릭터·돌·포즈·씬 라이브러리·소품)을 모두 정의한다.
// 1단계에서 쓰지 않는 필드도 자리를 먼저 만들어 2~5단계에서 데이터 이전이 생기지 않게 한다.

export type Vec3 = [number, number, number];
/** 쿼터니언 [x, y, z, w] */
export type Quat = [number, number, number, number];

export type Gender = 'male' | 'female';
export type BodyType = 'basic' | 'muscular' | 'elder' | 'child' | 'heavy';

/**
 * 관절 회전값: 뼈 이름 → 회전 쿼터니언.
 * 값은 '돌 공간(돌 루트 기준)에서 휴식 자세(T포즈) 대비 회전'이다.
 * 뼈의 로컬 축 규약(roll)과 무관하므로, 같은 T포즈 뼈대 이름을 가진 어떤 돌에도 그대로 적용된다.
 */
export type JointRotations = Record<string, Quat>;

export interface OutputSettings {
  /** 출력 가로 px (기본 1024) */
  width: number;
  background: 'white' | 'transparent';
  crosshair: boolean;
  shading: boolean;
}

/** 작품 */
export interface Work {
  /** 영문 대문자 3자리, 예: ACS */
  code: string;
  name: string;
  output: OutputSettings;
  createdAt: string;
  updatedAt: string;
}

/** 회차 */
export interface Episode {
  workCode: string;
  number: number;
  /** 컷 번호 순서 */
  cutOrder: number[];
  /** 가져온 글콘티 파일(NTT 엑셀) 정보 */
  scriptSource?: { fileName: string; importedAt: string };
  updatedAt: string;
}

/** 원고 카메라 */
export interface CameraState {
  position: Vec3;
  /** 도(degree). yaw: 수평 회전(+는 왼쪽으로), pitch: 상하(+는 올려봄), roll: 롤 */
  yaw: number;
  pitch: number;
  roll: number;
  /** 35mm 환산 초점거리(mm) */
  focalLength: number;
}

export interface LightState {
  /** 빛이 향하는 방향(단위 벡터) */
  direction: Vec3;
  /** 2단 셀 명암 켜기 */
  shading: boolean;
}

/** 컷에 놓인 돌 하나 */
export interface DollInstance {
  id: string;
  characterId: string;
  dollId: string;
  heightCm: number;
  /** 고정색 HEX. 캐릭터 색을 따르되 컷 데이터에도 사본을 둔다 */
  color: string;
  position: Vec3;
  rotation: Quat;
  joints: JointRotations;
}

/** 컷에 놓인 소품(3단계) */
export interface PropInstance {
  id: string;
  propId: string;
  position: Vec3;
  rotation: Quat;
  attachedTo?: { dollInstanceId: string; hand: 'left' | 'right' };
}

/** 컷 = 그 순간의 씬 전체 스냅샷 */
export interface Cut {
  number: number;
  /** 세로/가로 비율 1.0~2.0 */
  aspect: number;
  camera: CameraState;
  light: LightState;
  dolls: DollInstance[];
  props: PropInstance[];
  confirmed: boolean;
  outline: boolean;
  crosshair: boolean;
  /** 5단계 묶음 태그 */
  groupTags: string[];
  /** 자동 생성 설명(확정 때마다 재생성) */
  desc: string;
  /** 사람이 쓰는 메모 */
  memo: string;
  /** 5단계 생성 결과 이미지 경로 */
  generatedImages: string[];
  /** 글콘티 대사(NTT 엑셀 연동, 2단계 이후). position: 원고뷰 위/아래 */
  dialogue?: Array<{ speaker: string; text: string; position: 'top' | 'bottom' }>;
  /** 글콘티 지문(장면 설명, 사람이 쓴 것) */
  scriptNote?: string;
  updatedAt: string;
}

/** 캐릭터 */
export interface Character {
  id: string;
  workCode: string;
  name: string;
  /** 고정색 HEX */
  color: string;
  info: { age?: number; gender: Gender | 'other'; role?: string; oneLine?: string };
  appearanceTags: string[];
  heightCm: number;
  dollId: string;
  referenceImages: string[];
  mainReference?: string;
  /** 1단계 임시 캐릭터(돌 추가 시 자동 등록) */
  temporary: boolean;
}

/** 돌(프로그램 에셋) */
export interface DollAsset {
  id: string;
  name: string;
  gender: Gender;
  bodyType: BodyType;
  baseHeightCm: number;
  /** 내장 GLB 경로. null이면 코드로 만든 마네킹 */
  glbPath: string | null;
  /** GLB 뼈 이름 → 표준(Mixamo) 이름 매핑. 비어 있으면 동일 */
  boneMap: Record<string, string>;
  /** 목록에 보이지 않음(옛 데이터 호환용으로만 남긴 돌) */
  hidden?: boolean;
  /** 두 눈 사이 위치(휴식 돌 공간). 없으면 머리 치수에서 계산 */
  eye?: Vec3;
}

/** 포즈(2단계) */
export interface Pose {
  id: string;
  name: string;
  category: string;
  tags: string[];
  joints: JointRotations;
}

export type ShotSize = 'closeup' | 'bust' | 'waist' | 'full';
export type AngleTag = 'high' | 'eye' | 'low';

/** 씬 라이브러리 항목(2단계) */
export interface SceneLibraryItem {
  id: string;
  name: string;
  autoTags: {
    count: number;
    shot: ShotSize;
    angle: AngleTag;
    aspect: number;
    placement: string[];
  };
  situationTags: string[];
  slots: Array<{ slot: number; dollId: string; position: Vec3; rotation: Quat; joints: JointRotations }>;
  props: PropInstance[];
  camera: CameraState;
  aspect: number;
  thumbnail: string;
}

/** 소품(3단계) */
export interface PropAsset {
  id: string;
  name: string;
  tags: string[];
  model: { kind: 'glb'; path: string } | { kind: 'primitive'; shape: 'box' | 'cylinder' | 'sphere'; size: Vec3 };
  grip: { right?: { position: Vec3; rotation: Quat }; left?: { position: Vec3; rotation: Quat } };
  workCode: string | null;
}
