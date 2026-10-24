import { useEffect, useState } from 'react';
import { storage } from '../storage';

const cache = new Map<string, string>();
const keyOf = (code: string, chrId: string, file: string) => `${code}/${chrId}/${file}`;

/** 캐시에서 지운다(파일을 바꾸거나 지웠을 때) */
export function forgetRefUrl(code: string, chrId: string, file: string): void {
  const k = keyOf(code, chrId, file);
  const url = cache.get(k);
  if (url) URL.revokeObjectURL(url);
  cache.delete(k);
}

/** 레퍼런스 이미지 파일 → 브라우저 URL(캐시). 아직 못 읽었으면 null */
export function useRefUrl(code: string, chrId: string, file: string | null | undefined): string | null {
  const key = file ? keyOf(code, chrId, file) : null;
  const [url, setUrl] = useState<string | null>(key ? (cache.get(key) ?? null) : null);
  useEffect(() => {
    if (!key || !file) {
      setUrl(null);
      return;
    }
    const cached = cache.get(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    void storage.repository
      .readReference(code, chrId, file)
      .then((buf) => {
        if (cancelled || !buf) return;
        const ext = file.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
        const u = URL.createObjectURL(new Blob([buf], { type: mime }));
        cache.set(key, u);
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, code, chrId, file]);
  return url;
}
