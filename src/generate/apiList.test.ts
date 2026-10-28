import { describe, expect, it } from 'vitest';
import { DEFAULT_API_ID, DEFAULT_API_LIST, keyState, newCustomEntry, normalizeApiList, removeEntry, selectedApi } from './apiList';
import { cleanKeyInput, maskKey, redactKey } from './keys';

describe('API 목록', () => {
  it('기본 목록: 베니스 Flux 3이 기본, BFL 직접도 있다', () => {
    const list = normalizeApiList(undefined);
    expect(list.map((e) => e.id)).toEqual(['venice-flux3', 'bfl-flux3', 'openai-default', 'mock']);
    expect(selectedApi(list, DEFAULT_API_ID)).toMatchObject({ service: 'venice', model: 'flux-3-image-edit' });
    expect(selectedApi(list, 'bfl-flux3')).toMatchObject({ service: 'bfl', model: 'flux-3-image' });
    expect(selectedApi(list, '없는id').id).toBe(DEFAULT_API_ID);
  });
  it('저장된 목록을 읽을 때 기본 항목이 복구되고 잘못된 항목은 버려진다', () => {
    const list = normalizeApiList([{ id: 'venice-flux3', service: 'bfl', label: '내 이름', model: 'x' }, { id: 'bad' }, { id: 'c', service: 'custom', label: 'C', model: 'm', baseUrl: 'https://a/v1' }]);
    expect(list.find((e) => e.id === 'venice-flux3')).toMatchObject({ service: 'venice', label: '내 이름', model: 'x', builtin: true });
    expect(list.some((e) => e.id === 'bad')).toBe(false);
    expect(list.find((e) => e.id === 'c')).toMatchObject({ service: 'custom', builtin: false });
    expect(list.some((e) => e.id === 'mock')).toBe(true);
  });
  it('사용자 정의 추가·삭제, 기본 항목은 삭제 불가', () => {
    let list = normalizeApiList(undefined);
    const c = newCustomEntry(list, '내 서버', 'gpt-image-x', 'https://example.com/v1/');
    expect(c).toMatchObject({ id: 'custom-1', baseUrl: 'https://example.com/v1' });
    list = [...list, c];
    expect(newCustomEntry(list, '', '', 'https://b').id).toBe('custom-2');
    expect(removeEntry(list, 'custom-1')).toHaveLength(4);
    expect(removeEntry(list, 'venice-flux3')).toHaveLength(5);
  });
  it('키 상태: 키 없으면 키 필요, 모의는 필요 없음', () => {
    const [venice, , , mock] = DEFAULT_API_LIST;
    expect(keyState(venice, new Set())).toBe('missing');
    expect(keyState(venice, new Set(['venice-flux3']))).toBe('set');
    expect(keyState(mock, new Set())).toBe('not-needed');
  });
});

describe('키 마스킹·정리', () => {
  it('마스킹은 본문을 드러내지 않는다', () => {
    expect(maskKey('')).toBe('');
    expect(maskKey('short')).toBe('••••');
    expect(maskKey('sk-abcdefghijklmnop')).toBe('sk-••••op');
    expect(maskKey('sk-abcdefghijklmnop')).not.toContain('abcdefgh');
  });
  it('붙여넣기 정리', () => {
    expect(cleanKeyInput('  "Bearer abcdefgh12345"\n')).toEqual({ ok: true, key: 'abcdefgh12345' });
    expect(cleanKeyInput('abc def ghi jkl').ok).toBe(false);
    expect(cleanKeyInput('').ok).toBe(false);
    expect(cleanKeyInput('abc').ok).toBe(false);
  });
  it('오류 문구에서 키를 지운다', () => {
    expect(redactKey('invalid key abcdefgh12345 given', 'abcdefgh12345')).toBe('invalid key •••• given');
  });
});
