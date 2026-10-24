/** 짧은 고유 ID. 파일명에 쓰이므로 영문·숫자만 */
export function newId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${raw.slice(0, 10)}`;
}
