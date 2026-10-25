import { useStore } from '../state/store';
import { Icon } from './icons';
import { goToStart, saveNow } from './save';
import { StorageControls } from './StorageControls';
import { useShare } from '../storage/remote/service';

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TopBar() {
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const dirty = useStore((s) => s.dirty);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const saveError = useStore((s) => s.saveError);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const setGalleryOpen = useStore((s) => s.setGalleryOpen);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const setCharacterManagerFor = useStore((s) => s.setCharacterManagerFor);
  const outputCount = useStore((s) => s.outputCount);
  const readOnly = useStore((s) => s.readOnly);
  const shareUser = useShare((s) => s.user);
  const lockHolder = useShare((s) => s.lock?.holder?.userEmail ?? null);
  const holderName = lockHolder?.split('@')[0] ?? '다른 사람';
  const setGenerateOpen = useStore((s) => s.setGenerateOpen);
  const setAssembleOpen = useStore((s) => s.setAssembleOpen);
  const setScriptImportOpen = useStore((s) => s.setScriptImportOpen);
  const hasScript = useStore((s) => !!s.episode.scriptSource);
  const candidateCount = useStore((s) => s.cuts.reduce((n, c) => n + (c.generatedImages?.length ?? 0), 0));

  const openCharacters = async () => {
    if (useStore.getState().dirty) await saveNow();
    setCharacterManagerFor(work.code);
  };

  return (
    <header className="topbar">
      <div className="brand">
        씬 <span>돌</span>
      </div>
      <div className="sep" />
      <button onClick={() => void goToStart()} title="작품 관리로 돌아가기(저장됨). 작품·회차를 고르거나 캐릭터를 등록합니다">
        <Icon name="home" /> 작품 관리
      </button>
      <span className="doc-label" title={`작품 ${work.code} · ${work.name} · ${episode.number}화`}>
        <b>{work.name}</b> <span className="muted">{work.code}</span> · {episode.number}화{episode.title ? ` ${episode.title}` : ''}
      </span>
      <button className="icon" onClick={() => void openCharacters()} title="이 작품의 캐릭터 관리(설명·레퍼런스·돌 지정)">
        <Icon name="user" />
      </button>
      <div className="grow" />

      <StorageControls />
      {readOnly && (
        <span className="storage-chip share-chip readonly" title={`보기 전용: ${lockHolder ?? '다른 사람'}이(가) 이 회차를 작업 중입니다. 컷 편집·확정·저장이 막힙니다. 작품 관리로 돌아가 다른 회차를 고르거나, 5분 동안 신호가 없으면 다시 열어 넘겨받으세요`}>
          <Icon name="lock" /> 보기 전용 · {holderName}
        </span>
      )}
      {shareUser && !readOnly && (
        <span className="storage-chip share-chip" title={`공유 저장소에 로그인: ${shareUser.email ?? ''} · 작품·공용은 공유, 출력물은 내 폴더`}>
          <Icon name="cloudOn" /> {shareUser.email?.split('@')[0] ?? '공유'}
        </span>
      )}
      <div className="sep" />
      <button className="icon" onClick={() => void saveNow()} title="저장 (Ctrl+S)">
        <Icon name="save" />
      </button>
      <span className={`save-state ${saveError ? 'error' : dirty ? 'dirty' : ''}`} title={saveError ?? undefined}>
        {saveError ? '저장 실패' : dirty ? '변경됨' : lastSavedAt ? timeLabel(lastSavedAt) : ''}
      </span>
      <button className={hasScript ? 'active' : ''} onClick={() => setScriptImportOpen(true)} title="NTT 글콘티(엑셀·CSV)를 이 회차에 가져옵니다. 컷마다 대사·지문이 한 번에 들어옵니다">
        <Icon name="script" /> 글콘티 가져오기
      </button>
      <button className="icon" onClick={() => setExportOpen(true)} title="회차 일괄 출력(PNG + 설명 텍스트 + AI 전달 패키지)">
        <Icon name="export" />
      </button>
      <button className={`icon ${outputCount ? 'has-output' : ''}`} onClick={() => setGalleryOpen(true)} title={outputCount ? `출력물 보기: 이 회차에 출력된 컷 PNG ${outputCount}장` : '출력물 보기: 이 회차에는 아직 출력물이 없습니다'}>
        <Icon name="gallery" />
      </button>
      <button className={`icon ${candidateCount ? 'has-output' : ''}`} onClick={() => setGenerateOpen(true)} title={candidateCount ? `이미지 생성(5단계): 생성 후보 ${candidateCount}장. 묶음 생성·후보 비교` : '이미지 생성(5단계): 확정 컷을 묶어 AI 이미지 후보를 만들고 고름'}>
        <Icon name="sparkles" />
      </button>
      <button className="icon" onClick={() => setAssembleOpen(true)} title="원고 내보내기(6단계): 컷 그림과 대사를 NTT 서버로 보내 클립 스튜디오 콘티(.clip)를 받기">
        <Icon name="layers" />
      </button>
      <div className="sep" />
      <button className="icon" onClick={() => setSettingsOpen(true)} title="설정">
        <Icon name="settings" />
      </button>
      <button className="icon" onClick={() => setHelpOpen(true)} title="도움말: 조작법과 단축키">
        <Icon name="help" />
      </button>
    </header>
  );
}
