import type { Assembly } from '../assemble/model';
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
  /** 회차 제목(선택) */
  title?: string;
  /** 컷 번호 순서 */
  cutOrder: number[];
  /** 가져온 글콘티 파일(NTT 엑셀) 정보 */
  scriptSource?: { fileName: string; importedAt: string };
  /** 6단계 원고 조립 설정·말풍선 덮어쓰기(없으면 기본값. normalizeAssembly) */
  assembly?: Assembly;
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

export type Hand = 'left' | 'right';

/**
 * 컷에 놓인 소품(3단계).
 * attachedTo가 있으면 position·rotation은 그 손 뼈의 로컬 좌표(쥐기 오프셋, 뼈 크기 제거)이고, 없으면 월드 좌표다.
 */
export interface PropInstance {
  id: string;
  propId: string;
  position: Vec3;
  rotation: Quat;
  attachedTo?: { dollInstanceId: string; hand: Hand };
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

/**
 * 레퍼런스 기본 슬롯 8종: 얼굴 정면·측면·반측면·반측면2·후면, 전신 전면·측면·후면.
 * 다 채우지 않아도 되고(AI는 1장만 있어도 동작), 품질을 위해 채워 나간다.
 */
export type RefSlot = 'face_front' | 'face_side' | 'face_quarter' | 'face_quarter2' | 'face_back' | 'body_front' | 'body_side' | 'body_back';

/** 캐릭터 레퍼런스 이미지 하나. 파일은 작품/{코드}/캐릭터/{ID}/레퍼런스/ 에 둔다 */
export interface ReferenceImage {
  id: string;
  /** 기본 슬롯. null이면 사용자 지정 항목(복장·무기 등, 최대 10장) */
  slot: RefSlot | null;
  /** 사용자 지정 항목 이름(슬롯이면 비움) */
  name: string;
  /** 레퍼런스 폴더 안 파일명 */
  file: string;
  addedAt: string;
}

/** 캐릭터(작품에 종속). 돌에 지정하면 돌의 성별·키·고정색이 이 값을 따르고, AI 전달 패키지에 설명·레퍼런스가 실린다 */
export interface Character {
  id: string;
  workCode: string;
  name: string;
  /** 고정색 HEX */
  color: string;
  info: { age?: number; gender: Gender | 'other'; role?: string; oneLine?: string };
  /** 간략한 설명(AI 전달용 자유 서술) */
  description: string;
  appearanceTags: string[];
  heightCm: number;
  dollId: string;
  /** 레퍼런스 이미지: 기본 슬롯 8 + 사용자 지정 최대 10 */
  references: ReferenceImage[];
  /** 대표 레퍼런스(references의 id) */
  mainReference?: string;
  /** 1단계 임시 캐릭터(돌 추가 시 자동 등록). 캐릭터 관리 목록에는 보이지 않는다 */
  temporary: boolean;
  createdAt: string;
  updatedAt: string;
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

/** 포즈(2단계). 관절 회전값만 담아 체형과 무관하게 어떤 돌에도 적용한다. 파일은 공용/포즈/{ID}.json */
export interface Pose {
  id: string;
  name: string;
  /** 분류(서기·앉기·동작 … 자유 입력) */
  category: string;
  tags: string[];
  joints: JointRotations;
  /** 썸네일 PNG 경로(공용/포즈/{ID}.png). 없을 수 있다 */
  thumbnail?: string;
  createdAt?: string;
}

export type ShotSize = 'closeup' | 'bust' | 'waist' | 'full';
export type AngleTag = 'high' | 'eye' | 'low';

/** 씬 라이브러리의 돌 슬롯. 캐릭터는 담지 않고 불러올 때 슬롯→캐릭터를 지정한다 */
export interface SceneSlot {
  /** 1부터 */
  slot: number;
  dollId: string;
  /** 저장 당시 키(cm). 슬롯을 비워 임시 캐릭터로 불러올 때 쓰고, 캐릭터를 지정하면 그 캐릭터의 키를 따른다 */
  heightCm?: number;
  position: Vec3;
  rotation: Quat;
  joints: JointRotations;
}

/** 씬 라이브러리 항목(2단계). 파일은 공용/씬/{ID}.json + {ID}.png */
export interface SceneLibraryItem {
  id: string;
  name: string;
  /** 저장 때 프로그램이 붙이는 태그(원고 카메라 투영으로 판정) */
  autoTags: {
    /** 화면 안 돌 수 */
    count: number;
    /** 화면 안에서 가장 크게 잡힌 돌의 샷 크기 */
    shot: ShotSize;
    angle: AngleTag;
    aspect: number;
    /** 화면 안 돌마다 '왼쪽 앞' 식 배치 */
    placement: string[];
    /** 화면 안 돌마다 샷 크기 */
    shots?: ShotSize[];
  };
  /** 사람이 버튼으로 찍는 상황 태그(대화·전투 …) */
  situationTags: string[];
  slots: SceneSlot[];
  props: PropInstance[];
  camera: CameraState;
  aspect: number;
  /** 썸네일 PNG 경로 */
  thumbnail: string;
  createdAt?: string;
}

export type PropShape = 'box' | 'cylinder' | 'sphere';

/** 손 뼈 로컬 좌표의 쥐기 오프셋(뼈 크기 제거, m) */
export interface GripTransform {
  position: Vec3;
  rotation: Quat;
}

/** 소품(3단계). 파일은 공용/소품/{ID}.json (+ {ID}.glb, {ID}.png) */
export interface PropAsset {
  id: string;
  name: string;
  tags: string[];
  /** GLB(저장소 경로, m 단위) 또는 기본 도형(size는 m: 상자 가로·높이·깊이, 원기둥 지름·높이, 구 지름) */
  model: { kind: 'glb'; path: string } | { kind: 'primitive'; shape: PropShape; size: Vec3 };
  /** 오른손/왼손 기본 쥐기(없으면 손바닥 쪽 기본값) */
  grip: { right?: GripTransform; left?: GripTransform };
  /** 소속 작품(null이면 공용) */
  workCode: string | null;
  /** 색(HEX). 캐릭터 구분색과 겹치지 않는 회색 계열이 기본 */
  color?: string;
  /** 단독 촬영 썸네일 경로 */
  thumbnail?: string;
  createdAt?: string;
}
