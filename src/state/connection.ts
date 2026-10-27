/**
 * 연결 설정(이미지 생성 함수 주소·접근 토큰·NTT 주소·토큰 등)을 이 브라우저(localStorage)에만 두면
 * 브라우저를 바꾸거나 저장소를 지울 때마다 풀린다. 작업 폴더/브라우저 저장소의 `생성/연결설정.json`에도 한 벌 둬서
 * 같은 저장소를 쓰면 설정이 되살아나게 한다. `생성/`은 공유 저장소에 올라가지 않고 로컬에만 있다.
 */
import { storage } from '../storage';
import { useStore } from './store';
import { mergeConnection, pickConnection, type ConnKey } from './connectionMerge';
import type { Settings } from './settings';

export const CONNECTION_FILE = '생성/연결설정.json';
let started = false;

/** 앱 시작 때 한 번: 파일에서 복원하고, 이후 연결 설정이 바뀌면 파일에 쓴다 */
export async function startConnectionSync(): Promise<void> {
  try {
    const text = await storage.backend.readText(CONNECTION_FILE);
    if (text) {
      const patch = mergeConnection(useStore.getState().settings, JSON.parse(text) as Partial<Pick<Settings, ConnKey>>);
      if (Object.keys(patch).length) useStore.getState().updateSettings(patch);
    }
  } catch {
    /* 파일이 없거나 읽을 수 없으면 무시 */
  }
  if (started) return;
  started = true;
  let timer = 0;
  useStore.subscribe(
    (s) => s.settings,
    (settings) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const conn = pickConnection(settings);
        if (!conn.genToken && !conn.nttToken && !conn.genEndpoint) return;
        void storage.backend.writeText(CONNECTION_FILE, JSON.stringify(conn, null, 2)).catch(() => undefined);
      }, 600);
    },
  );
}
