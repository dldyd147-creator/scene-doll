import { describe, expect, it } from 'vitest';
import { mergeConnection } from './connectionMerge';
import { DEFAULT_SETTINGS } from './settings';

describe('연결 설정 복원', () => {
  it('비어 있는 토큰·주소만 저장본으로 채운다', () => {
    const cur = { ...DEFAULT_SETTINGS, genToken: '', nttToken: '', genEndpoint: '' };
    const patch = mergeConnection(cur, { genToken: 'tk', nttToken: 'nt', genEndpoint: 'https://f/', genProvider: 'venice', genEngine: 'remote' });
    expect(patch).toMatchObject({ genToken: 'tk', nttToken: 'nt', genEndpoint: 'https://f/', genProvider: 'venice', genEngine: 'remote' });
  });
  it('이미 입력한 값은 덮어쓰지 않고, 저장본이 비면 아무것도 바꾸지 않는다', () => {
    const cur = { ...DEFAULT_SETTINGS, genToken: 'mine' };
    expect(mergeConnection(cur, { genToken: 'old' }).genToken).toBeUndefined();
    expect(mergeConnection({ ...DEFAULT_SETTINGS, genToken: '' }, {})).toEqual({});
  });
});
