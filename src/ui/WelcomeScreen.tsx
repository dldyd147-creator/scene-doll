import { useEffect, useState } from 'react';
import { native } from '../native';
import { useStore } from '../state/store';
import { ApiListSettings } from './ApiListSettings';
import { chooseWorkFolder, finishWelcome, useDesktopFolder } from './save';

/** 데스크톱 첫 실행: 작업 폴더 고르기 → API 키 안내 → 작품 관리 */
export function WelcomeScreen() {
  const folderName = useStore((s) => s.folderName);
  const [suggest, setSuggest] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void native?.workDir.suggest().then(setSuggest);
  }, []);

  const useDefault = async () => {
    setError(null);
    try {
      if (await useDesktopFolder(suggest)) setChosen(suggest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const pick = async () => {
    setError(null);
    try {
      if (await chooseWorkFolder()) setChosen((await native?.workDir.get()) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>씬 돌에 오신 것을 환영합니다</h1>
        {!chosen ? (
          <>
            <div>
              <b>1. 작업 폴더를 정하세요.</b> 작품·캐릭터·콘티·생성한 이미지가 이 폴더에 파일로 저장됩니다. 탐색기에서 바로 열어 볼 수 있고, 폴더째 백업하면 됩니다.
            </div>
            <div className="welcome-path">{suggest || '…'}</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="primary" onClick={() => void useDefault()} disabled={!suggest}>
                이 위치를 쓰기 (권장)
              </button>
              <button onClick={() => void pick()}>다른 폴더 고르기…</button>
            </div>
          </>
        ) : (
          <>
            <div>
              작업 폴더: <span className="welcome-path">{chosen}</span>
            </div>
            <div>
              <b>2. 이미지 생성 서비스 키를 넣으세요.</b> 쓸 서비스 옆의 '키 넣기'를 눌러 붙여넣기만 하면 됩니다. 키는 윈도우 계정으로 암호화해 이 PC에만 저장되고 화면에 다시 나타나지 않습니다. 지금 안 넣어도 되고, 나중에 설정 &gt; 이미지 생성에서 넣을 수 있습니다.
            </div>
            <ApiListSettings />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="primary" onClick={finishWelcome}>
                시작하기{folderName ? '' : ''}
              </button>
            </div>
          </>
        )}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>
    </div>
  );
}
