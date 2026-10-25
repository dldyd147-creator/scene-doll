import type { CSSProperties } from 'react';

/** 선 아이콘(24px 뷰박스, stroke 기반). 이름 → path */
const PATHS: Record<string, string> = {
  // 조작 모드
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V12m0-5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.6 13.8a1.5 1.5 0 0 1 2.4-1.8L8 13',
  move: 'M12 2v20M2 12h20M12 2l-3 3m3-3l3 3M12 22l-3-3m3 3l3-3M2 12l3-3m-3 3l3 3M22 12l-3-3m3 3l-3 3',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  // 돌 작업
  mirror: 'M12 3v18M7 7l-4 5 4 5V7zM17 7l4 5-4 5V7z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5',
  resetAll: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5M9 12l2 2 4-4',
  ground: 'M12 3v12m0 0l-4-4m4 4l4-4M4 20h16',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  fix: 'M12 3l2 5 5 .5-4 3.5 1.5 5L12 14l-4.5 3L9 12 5 8.5 10 8z',
  // 시점
  fitAll: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  focus: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  // 표시
  shading: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  crosshair: 'M12 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 4v10M7 9h10M12 14v7',
  outline: 'M12 3c-4 0-6 3-6 6s2 4 2 7v5h8v-5c0-3 2-4 2-7s-2-6-6-6z',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  frustum: 'M4 4l16 8-16 8zM4 4l6 8-6 8',
  shoulder: 'M6 10a6 6 0 0 1 12 0M12 4v6M8 20l4-6 4 6',
  feet: 'M8 4c-2 0-3 2-3 5s1 5 3 5 3-2 3-5-1-5-3-5zM16 10c-2 0-3 2-3 5s1 5 3 5 3-2 3-5-1-5-3-5z',
  wrist: 'M7 7h10v6a5 5 0 0 1-10 0zM12 13v8',
  limits: 'M4 12h6M14 12h6M10 7v10M14 7v10',
  // 파일·앱
  folder: 'M3 6h6l2 2h10v12H3z',
  folderOpen: 'M3 6h6l2 2h10v3M3 6v14h16l3-9H7l-2 6',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  export: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
  gallery: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7M12 17v.5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5m0 0l-6 6m6-6l6 6',
  down: 'M12 5v14m0 0l-6-6m6 6l6-6',
  check: 'M5 12l5 5L20 7',
  external: 'M14 4h6v6M20 4l-9 9M19 14v6H4V5h6',
  cut: 'M4 4h16v16H4zM4 10h16',
  eyeLevel: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  pov: 'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM9 10h6l1 5h-8zM4 20l8-5 8 5',
  aim: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  toManu: 'M14 5h7v14h-7M3 5h7v14H3M13 12H6m0 0l3-3m-3 3l3 3',
  toWork: 'M3 5h7v14H3M14 5h7v14h-7M11 12h7m0 0l-3-3m3 3l-3 3',
  doll: 'M12 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM7 10h10l-2 5v6h-2v-4h-2v4H9v-6z',
  home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  upload: 'M12 16V4m0 0l-4 4m4-4l4 4M4 20h16',
  edit: 'M4 20h4L18 10l-4-4L4 16zM13 7l4 4',
  package: 'M12 3l9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8',
  // 시점 복사(카메라 + 화살표)
  camArrowRight: 'M2 8h3l1.5-2h4L12 8h2v9H2zM8 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16 12.5h6m0 0l-2.5-2.5m2.5 2.5L19.5 15',
  camArrowLeft: 'M10 8h2l1.5-2h4L19 8h3v9H10zM16 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 12.5H2m0 0l2.5-2.5M2 12.5L4.5 15',
  // 핸드 오퍼레이터
  fingers: 'M7 21v-5.5l-3-4 1.8-1.4 2.7 3.2V5h2v7h1V3h2v9h1V5h2v7h1V8h2v7a6 6 0 0 1-6 6z',
  // 씬·포즈 라이브러리
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L21 21',
  bookmarkPlus: 'M6 3h12v18l-6-4-6 4zM12 7v6M9 10h6',
  pose: 'M12 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 6.5v6M8 9.5l4-3 4 3M12 12.5l-3.5 8M12 12.5l3.5 8',
  swap: 'M4 7h13m0 0l-3-3m3 3l-3 3M20 17H7m0 0l3-3m-3 3l3 3',
  tag: 'M3 3h8l10 10-8 8L3 11zM7.5 7.5h.01',
  // 글콘티
  script: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6',
  // 4단계
  torso: 'M9 3h6l2 8H7zM8 11h8v10H8zM4 10l3-4M20 10l-3-4',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  // 5단계 이미지 생성(반짝)
  sparkles: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1-2.1-.9 2.1-.9zM5 15l.7 1.6 1.6.7-1.6.7L5 19.6l-.7-1.6-1.6-.7 1.6-.7z',
};

export interface IconProps {
  name: keyof typeof PATHS | string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ name, size = 16, style, className }: IconProps) {
  const d = PATHS[name] ?? PATHS.help;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
