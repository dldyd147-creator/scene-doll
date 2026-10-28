import { useEffect, useState } from 'react';
import { storage } from '../storage';

const cache = new Map<string, string>();

/** 작품 표지 파일 → 브라우저 URL. version(작품 수정 시각)이 바뀌면 다시 읽는다 */
export function useWorkCover(code: string, file: string | undefined, version: string): string | null {
  const key = file ? `${code}/${file}/${version}` : null;
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
      .readWorkCover(code, file)
      .then((buf) => {
        if (cancelled || !buf) return;
        const u = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
        cache.set(key, u);
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, code, file]);
  return url;
}

/** 고른 이미지를 표지 크기(긴 변 480px)로 줄여 JPEG로 만든다 */
export async function makeCoverBlob(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 처리할 수 없습니다');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  if (!blob) throw new Error('이미지를 저장 형식으로 바꾸지 못했습니다');
  return blob;
}
