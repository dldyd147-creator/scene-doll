import { isDesktop } from './native';

/** 기능 플래그. 데스크톱(Electron) 빌드에서 협업 기능은 숨기되 코드는 남겨 둔다 */
export const features = {
  /** Supabase 공유 저장소·로그인·회차 잠금·구성원 */
  share: !isDesktop,
  /** 브라우저 내부 저장(IndexedDB)·폴더 권한 재연결 */
  browserStorage: !isDesktop,
};
