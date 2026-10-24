import { useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  /** 드래그 중 미리보기(선택). 없으면 onChange를 드래그 중에도 부른다 */
  onPreview?: (v: number) => void;
  /** 픽셀당 증가량 */
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  unit?: string;
  width?: number;
  title?: string;
}

/**
 * 숫자 입력. 가로로 끌면 값이 바뀌고(블렌더식), 클릭하면 직접 입력한다.
 */
export function DragNumber({ value, onChange, onPreview, step = 0.01, min = -Infinity, max = Infinity, digits = 2, unit, width = 70, title }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(digits).replace(/\.?0+$/, '') || '0' : '');

  if (editing) {
    return (
      <input
        className="num"
        style={{ width }}
        type="text"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const v = parseFloat(text);
          if (!Number.isNaN(v)) onChange(clamp(v));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  }

  return (
    <span
      className="dragnum"
      style={{ width }}
      title={title ?? '끌어서 조절 · 클릭해서 입력'}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, start: value, moved: false, last: value };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        const fine = e.shiftKey ? 0.1 : 1;
        const v = clamp(d.start + dx * step * fine);
        d.last = v;
        (onPreview ?? onChange)(v);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (!d) return;
        if (!d.moved) {
          setText(fmt(value));
          setEditing(true);
        } else if (onPreview) {
          onChange(d.last);
        }
      }}
    >
      {fmt(value)}
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}
