/** 키 마스킹: 화면·로그에는 키 본문을 내지 않는다. 오류 문구에 섞여 나온 키도 지운다 */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 3)}••••${k.slice(-2)}`;
}

/** 입력 정리: 앞뒤 공백·따옴표·'Bearer ' 접두를 떼고, 공백·줄바꿈이 섞이면 거부(붙여넣기 실수) */
export function cleanKeyInput(raw: string): { ok: true; key: string } | { ok: false; reason: string } {
  let k = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  k = k.replace(/^Bearer\s+/i, '');
  if (!k) return { ok: false, reason: '키가 비어 있습니다' };
  if (/\s/.test(k)) return { ok: false, reason: '키 안에 공백이나 줄바꿈이 있습니다. 키만 복사해 붙여넣으세요' };
  if (k.length < 8) return { ok: false, reason: '키가 너무 짧습니다' };
  return { ok: true, key: k };
}

/** 텍스트(오류 메시지 등)에서 키 문자열을 지운다 */
export function redactKey(text: string, key: string): string {
  const k = key.trim();
  return k ? text.split(k).join('••••') : text;
}
