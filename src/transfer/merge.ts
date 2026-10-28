/**
 * 이동 패키지 합치기 규칙(순수 로직). 파일 시스템을 모른다 — 경로와 updatedAt만 본다.
 * 규칙은 scene-doll-spec.md '7단계 > 이동 패키지 > 합치기 규칙'.
 */
export type ConflictPolicy = 'skip' | 'merge' | 'overwrite' | 'rename';

export const POLICY_LABEL: Record<ConflictPolicy, string> = {
  skip: '건너뛰기',
  merge: '합치기(새로운 쪽)',
  overwrite: '덮어쓰기',
  rename: '둘 다 남기기',
};

export interface FileInfo {
  exists: boolean;
  /** JSON 안의 updatedAt (JSON이 아니거나 없으면 undefined) */
  updatedAt?: string;
}

/** 'a/b/c.json' → 경로 조각 */
const segs = (p: string): string[] => p.split('/').filter(Boolean);

/** 경로 검증: 상대 경로, '..'·'.'·빈 조각·역슬래시·드라이브 문자 금지 */
export function isSafePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path) || path.includes('\0')) return false;
  const parts = path.split('/');
  return parts.every((s) => s !== '' && s !== '.' && s !== '..');
}

/**
 * 파일이 '주인'으로 따르는 JSON 경로. 주인의 승패가 이 파일의 승패를 정한다. 주인이 없으면 null.
 * - 공용/씬/ID.png → 공용/씬/ID.json (소품 .glb도 같은 규칙)
 * - 작품/C/캐릭터/ID/… → 작품/C/캐릭터/ID.json
 * - 작품/C/회차/N/썸네일/K.png → 작품/C/회차/N/컷/K.json
 */
export function ownerOf(path: string): string | null {
  const s = segs(path);
  if (s[0] === '공용' && s.length === 3) {
    const m = /^(.+)\.(png|glb)$/.exec(s[2]);
    return m ? `${s[0]}/${s[1]}/${m[1]}.json` : null;
  }
  if (s[0] === '작품' && s[2] === '캐릭터' && s.length > 4) return `작품/${s[1]}/캐릭터/${s[3]}.json`;
  if (s[0] === '작품' && s[2] === '회차' && s[4] === '썸네일' && s.length === 6) {
    const m = /^(.+)\.png$/.exec(s[5]);
    return m ? `작품/${s[1]}/회차/${s[3]}/컷/${m[1]}.json` : null;
  }
  return null;
}

export type FileAction = 'copy-new' | 'copy-newer' | 'copy-overwrite' | 'keep';

/** JSON 하나의 승패. pkg가 이기면 true */
export function packageWins(pkg: FileInfo, cur: FileInfo, policy: ConflictPolicy): boolean {
  if (!cur.exists) return true;
  if (policy === 'overwrite') return true;
  if (policy === 'skip') return false;
  // merge: updatedAt이 더 새로운 쪽. 같거나 한쪽이라도 없으면 기존 유지
  if (!pkg.updatedAt || !cur.updatedAt) return false;
  const a = Date.parse(pkg.updatedAt);
  const b = Date.parse(cur.updatedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return pkg.updatedAt > cur.updatedAt;
  return a > b;
}

/**
 * 파일 하나를 어떻게 할지.
 * ownerWon: 주인 JSON이 패키지 쪽 승이면 true, 패 false, 주인 없음/주인 정보 없음 undefined.
 */
export function decideFile(pkg: FileInfo, cur: FileInfo, policy: ConflictPolicy, ownerWon: boolean | undefined): FileAction {
  if (!cur.exists) {
    // 주인이 졌으면(기존이 주인) 보조 파일이 없더라도 가져오지 않는다 — 단, 주인 자체도 기존에 없는 경우는 주인이 이긴 것으로 처리되어 여기 오지 않는다
    return ownerWon === false ? 'keep' : 'copy-new';
  }
  if (policy === 'overwrite') return 'copy-overwrite';
  if (policy === 'skip') return 'keep';
  if (ownerWon !== undefined) return ownerWon ? 'copy-newer' : 'keep';
  if (pkg.updatedAt !== undefined || cur.updatedAt !== undefined) return packageWins(pkg, cur, policy) ? 'copy-newer' : 'keep';
  return 'keep'; // 주인 없는 이진 파일은 기존 유지
}

/** 둘 다 남기기: 작품 코드를 새 코드로 바꾼 경로. 작품/·생성/·출력/·패키지/ 아래의 첫 조각이 코드 */
export function renameWorkPath(path: string, from: string, to: string): string {
  const s = segs(path);
  if ((s[0] === '작품' || s[0] === '생성' || s[0] === '출력') && s[1] === from) {
    s[1] = to;
    return s.join('/');
  }
  return path;
}

/** JSON 본문의 작품 코드 필드를 바꾼다(작품.json의 code, 그 밖의 최상위 workCode, 소품 workCode). 문자열이 아니면 그대로 */
export function rewriteWorkCodeJson(text: string, from: string, to: string): string {
  try {
    const v = JSON.parse(text) as unknown;
    const fix = (o: unknown, depth: number): void => {
      if (!o || typeof o !== 'object' || depth > 6) return;
      if (Array.isArray(o)) {
        for (const x of o) fix(x, depth + 1);
        return;
      }
      const rec = o as Record<string, unknown>;
      if (rec.workCode === from) rec.workCode = to;
      if (depth === 0 && rec.code === from) rec.code = to;
      // 컷·캐릭터 안의 경로 문자열(생성 후보 경로 등)
      for (const [k, val] of Object.entries(rec)) {
        if (typeof val === 'string' && val.includes(`/${from}/`)) rec[k] = val.replace(new RegExp(`(^|/)(작품|생성|출력)/${from}/`, 'g'), `$1$2/${to}/`);
        else if (Array.isArray(val) && val.every((x) => typeof x === 'string')) rec[k] = (val as string[]).map((x) => x.replace(new RegExp(`(^|/)(작품|생성|출력)/${from}/`, 'g'), `$1$2/${to}/`));
        else fix(val, depth + 1);
      }
    };
    fix(v, 0);
    return JSON.stringify(v, null, 2);
  } catch {
    return text;
  }
}

/** 둘 다 남기기에 쓸 빈 코드 제안: 원래 코드의 마지막 글자부터 바꿔 가며 쓰이지 않은 것을 찾는다 */
export function suggestCode(code: string, used: ReadonlySet<string>): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const base = (code.toUpperCase() + 'AAA').slice(0, 3).split('');
  for (let pos = 2; pos >= 0; pos--) {
    for (const ch of A) {
      const cand = [...base];
      cand[pos] = ch;
      const c = cand.join('');
      if (!used.has(c) && c !== code) return c;
    }
  }
  for (const a of A) for (const b of A) for (const c of A) if (!used.has(a + b + c)) return a + b + c;
  return code;
}

/** 작품 코드 규칙: 영문 대문자 3자 */
export const isValidWorkCode = (code: string): boolean => /^[A-Z]{3}$/.test(code);
