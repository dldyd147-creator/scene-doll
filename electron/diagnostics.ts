import { app, type BrowserWindow, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 멈춤·오류 기록. 창이 응답하지 않으면 그 순간 화면 쪽 코드가 어디를 돌고 있는지(호출 줄)를 남긴다.
 * 파일: 사용자 데이터 폴더의 logs/diagnostics.log (Windows: %APPDATA%\씬 돌\logs\diagnostics.log)
 */
const MAX_BYTES = 1_000_000;
const KEEP_BYTES = 300_000;

export const diagnosticsPath = (): string => path.join(app.getPath('userData'), 'logs', 'diagnostics.log');

let writing: Promise<void> = Promise.resolve();

/** 한 줄 기록. 실패해도 앱을 막지 않는다. 쓰기는 순서대로 이어 붙인다 */
export function diag(line: string): Promise<void> {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  writing = writing
    .then(async () => {
      const file = diagnosticsPath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        const st = await fs.stat(file);
        if (st.size > MAX_BYTES) {
          const buf = await fs.readFile(file);
          await fs.writeFile(file, buf.subarray(buf.length - KEEP_BYTES));
        }
      } catch {
        /* 아직 없음 */
      }
      await fs.appendFile(file, `${stamp} ${line}\n`, 'utf8');
    })
    .catch(() => undefined);
  return writing;
}

interface CallFrame {
  functionName: string;
  url: string;
  location: { lineNumber: number; columnNumber: number };
}

/**
 * 응답 없음일 때 화면 프로세스의 실행을 잠시 세워 호출 줄을 읽고 바로 이어 달리게 한다(DevTools의 일시 정지와 같다).
 * 멈춘 뒤에는 Debugger.enable 같은 일반 명령이 처리되지 않으므로 디버거는 창을 열 때부터 켜 둔다(일시 정지 명령만 끼어들 수 있다).
 * 자바스크립트가 아니라 그래픽·시스템 대기라면 일시 정지가 오지 않으므로 그 사실을 남긴다. 실행을 강제로 끊지는 않는다
 */
async function captureHangStack(wc: WebContents): Promise<void> {
  if (wc.isDestroyed() || !wc.debugger.isAttached()) {
    await diag('  호출 줄 읽기 불가: 디버거가 연결되어 있지 않음');
    return;
  }
  try {
    const paused = new Promise<{ callFrames: CallFrame[] } | null>((resolve) => {
      const timer = setTimeout(() => {
        wc.debugger.removeListener('message', onMsg);
        resolve(null);
      }, 8000);
      const onMsg = (_e: unknown, method: string, params: unknown) => {
        if (method !== 'Debugger.paused') return;
        clearTimeout(timer);
        wc.debugger.removeListener('message', onMsg);
        resolve(params as { callFrames: CallFrame[] });
      };
      wc.debugger.on('message', onMsg);
    });
    void wc.debugger.sendCommand('Debugger.pause').catch(() => undefined);
    const p = await paused;
    if (!p) {
      await diag('  자바스크립트가 달리고 있지 않음(그래픽 처리나 시스템 대기로 멈춘 것으로 보임)');
      return;
    }
    const frames = p.callFrames.slice(0, 25).map((f) => `    ${f.functionName || '(이름 없음)'}  ${f.url.split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`);
    await diag(`  멈춘 순간의 호출 줄(위가 가장 안쪽):\n${frames.join('\n')}`);
    void wc.debugger.sendCommand('Debugger.resume').catch(() => undefined);
  } catch (e) {
    await diag(`  호출 줄 읽기 실패: ${String(e)}`);
  }
}

/** 디버거를 붙이고 켠다(페이지를 새로 불러올 때마다 다시 켠다). 실패해도 앱은 그대로 쓴다 */
function armDebugger(wc: WebContents): void {
  const enable = (): void => {
    if (wc.isDestroyed()) return;
    void wc.debugger.sendCommand('Debugger.enable').catch(() => undefined);
  };
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    enable();
    wc.on('dom-ready', enable);
  } catch (e) {
    void diag(`디버거 연결 실패(멈춤 호출 줄은 못 남김): ${String(e)}`);
  }
}

const PING_MS = 1000;
const STALL_MS = 6000;

function startWatchdog(wc: WebContents): void {
  let sentAt = 0;
  let stalled = false;
  const timer = setInterval(() => {
    if (wc.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    const now = Date.now();
    if (sentAt) {
      if (!stalled && now - sentAt > STALL_MS) {
        stalled = true;
        void diag(`멈춤 감지: 화면이 ${Math.round((now - sentAt) / 1000)}초 넘게 응답하지 않음`);
        void captureHangStack(wc);
      }
      return;
    }
    sentAt = now;
    wc.executeJavaScript('0').then(
      () => {
        if (stalled) void diag(`응답 회복: ${Math.round((Date.now() - sentAt) / 1000)}초 만에 돌아옴`);
        stalled = false;
        sentAt = 0;
      },
      () => {
        stalled = false;
        sentAt = 0; // 페이지를 불러오는 중이면 실패한다
      },
    );
  }, PING_MS);
  wc.once('destroyed', () => clearInterval(timer));
}

/** 창 하나에 멈춤·충돌·콘솔 오류 기록을 붙인다 */
export function installDiagnostics(win: BrowserWindow): void {
  const wc = win.webContents;
  armDebugger(wc);
  void diag(`--- 시작 v${app.getVersion()} · electron ${process.versions.electron} · ${process.platform} ${process.arch}`);
  // Chromium의 '응답 없음' 판정은 디버거가 붙어 있으면 꺼지고 입력이 있어야만 켜진다. 그래서 직접 감시한다:
  // 화면에 1초마다 가벼운 명령을 보내 STALL_MS 안에 답이 안 오면 멈춘 것으로 보고 호출 줄을 남긴다
  startWatchdog(wc);
  wc.on('render-process-gone', (_e, d) => void diag(`화면 프로세스 종료: ${d.reason} (코드 ${d.exitCode})`));
  wc.on('console-message', (e) => {
    if (e.level === 'error') void diag(`화면 오류: ${e.message.slice(0, 600)} (${e.sourceId.split('/').pop()}:${e.lineNumber})`);
  });
  app.on('child-process-gone', (_e, d) => void diag(`보조 프로세스 종료: ${d.type} ${d.reason} (코드 ${d.exitCode})`));
}
