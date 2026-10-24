import { useEffect, useState } from 'react';
import { storage } from '../storage';
import { paths } from '../storage/repository';
import { useStore } from '../state/store';
import { Icon } from './icons';

interface Item {
  name: string;
  url?: string;
  text?: string;
  kind: 'png' | 'md' | 'json' | 'other';
}

/** 출력 폴더의 파일을 앱 안에서 본다(브라우저는 탐색기를 직접 열 수 없다) */
export function OutputGallery() {
  const open = useStore((s) => s.galleryOpen);
  const setOpen = useStore((s) => s.setGalleryOpen);
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const storageKind = useStore((s) => s.storageKind);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folder = paths.outputDir(work.code, episode.number);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      try {
        const backend = storage.backend;
        const files = (await backend.list(folder)).filter((f) => f.kind === 'file').sort((a, b) => a.name.localeCompare(b.name));
        const out: Item[] = [];
        for (const f of files) {
          const path = `${folder}/${f.name}`;
          if (f.name.endsWith('.png')) {
            const buf = await backend.readBinary(path);
            if (buf) {
              const url = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
              urls.push(url);
              out.push({ name: f.name, url, kind: 'png' });
            }
          } else if (f.name.endsWith('.md')) {
            out.push({ name: f.name, text: (await backend.readText(path)) ?? '', kind: 'md' });
          } else if (f.name.endsWith('.json')) {
            out.push({ name: f.name, kind: 'json' });
          } else out.push({ name: f.name, kind: 'other' });
        }
        if (!cancelled) setItems(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
      setItems(null);
      setError(null);
    };
  }, [open, folder]);

  if (!open) return null;
  const pngs = items?.filter((i) => i.kind === 'png') ?? [];
  const md = items?.find((i) => i.kind === 'md');
  const jsonCount = items?.filter((i) => i.kind === 'json').length ?? 0;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>
          출력물 보기 <span className="muted small">{folder}</span>
        </h2>
        <div className="muted small">
          {storageKind === 'folder' ? '작업 폴더 안의 같은 경로에 파일이 있습니다. 탐색기에서 작업 폴더를 열어 찾으세요.' : '브라우저 내부 저장소의 파일입니다. 작업 폴더를 지정하면 탐색기에서 바로 보입니다.'}
        </div>
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        {!items && !error && <div className="muted">불러오는 중…</div>}
        {items && items.length === 0 && <div className="muted">아직 출력물이 없습니다. 컷을 확정한 뒤 출력을 누르세요.</div>}
        {pngs.length > 0 && (
          <div className="gallery">
            {pngs.map((p) => (
              <a key={p.name} className="gallery-item" href={p.url} target="_blank" rel="noreferrer" title="새 탭에서 열기">
                <img src={p.url} alt={p.name} />
                <span className="small">
                  {p.name} <Icon name="external" size={12} />
                </span>
              </a>
            ))}
          </div>
        )}
        {md && (
          <details open>
            <summary>
              {md.name} <span className="muted small">· 컷 JSON {jsonCount}개</span>
            </summary>
            <pre className="md-preview">{md.text}</pre>
          </details>
        )}
        <div className="actions">
          <button className="primary" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
