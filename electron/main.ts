import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cancelGeneration, runGeneration } from './generate';
import { createKeyStore } from './keystore';
import { createWorkFs, PathError, type WorkFs } from './workFs';
import { cleanKeyInput } from '../src/generate/keys';

const SCHEME = 'scenedoll';
const DEV_URL = process.env.SCENEDOLL_DEV_URL;

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (process.env.SCENEDOLL_USER_DATA) app.setPath('userData', process.env.SCENEDOLL_USER_DATA);
app.setName('씬 돌');

const configFile = (): string => path.join(app.getPath('userData'), 'config.json');
let workRoot: string | null = null;
let workFs: WorkFs | null = null;
let mainWindow: BrowserWindow | null = null;

async function readConfig(): Promise<{ workDir?: string }> {
  try {
    return JSON.parse(await fs.readFile(configFile(), 'utf8')) as { workDir?: string };
  } catch {
    return {};
  }
}

async function setWorkDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  workRoot = dir;
  workFs = createWorkFs(dir);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(configFile(), JSON.stringify({ workDir: dir }, null, 2), 'utf8');
}

async function restoreWorkDir(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg.workDir) return;
  try {
    const st = await fs.stat(cfg.workDir);
    if (st.isDirectory()) {
      workRoot = cfg.workDir;
      workFs = createWorkFs(cfg.workDir);
    }
  } catch {
    /* 폴더가 사라졌으면 첫 실행처럼 다시 고르게 한다 */
  }
}

function needFs(): WorkFs {
  if (!workFs) throw new PathError('작업 폴더가 아직 정해지지 않았습니다');
  return workFs;
}

const toArrayBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function registerIpc(): void {
  const keys = createKeyStore(app.getPath('userData'), safeStorage);

  ipcMain.handle('workdir:get', () => workRoot);
  ipcMain.handle('workdir:suggest', () => path.join(app.getPath('documents'), '씬 돌 작업'));
  ipcMain.handle('workdir:use', async (_e, dir: string) => {
    await setWorkDir(dir);
    return dir;
  });
  ipcMain.handle('workdir:choose', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: '작업 폴더 선택', defaultPath: workRoot ?? app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    await setWorkDir(r.filePaths[0]);
    return workRoot;
  });
  ipcMain.handle('workdir:reveal', async () => {
    if (workRoot) await shell.openPath(workRoot);
  });

  ipcMain.handle('fs:readText', (_e, p: string) => needFs().readText(p));
  ipcMain.handle('fs:writeText', (_e, p: string, t: string) => needFs().writeText(p, t));
  ipcMain.handle('fs:readBinary', async (_e, p: string) => {
    const b = await needFs().readBinary(p);
    return b ? toArrayBuffer(b) : null;
  });
  ipcMain.handle('fs:writeBinary', (_e, p: string, d: ArrayBuffer) => needFs().writeBinary(p, new Uint8Array(d)));
  ipcMain.handle('fs:list', (_e, d: string) => needFs().list(d));
  ipcMain.handle('fs:remove', (_e, p: string) => needFs().remove(p));
  ipcMain.handle('fs:exists', (_e, p: string) => needFs().exists(p));

  ipcMain.handle('keys:status', () => keys.status());
  ipcMain.handle('keys:set', (_e, id: string, key: string) => {
    const c = cleanKeyInput(key);
    return c.ok ? keys.set(id, c.key) : { ok: false as const, reason: c.reason };
  });
  ipcMain.handle('keys:clear', (_e, id: string) => keys.clear(id));

  ipcMain.handle('gen:run', (_e, req) => runGeneration(req, keys));
  ipcMain.handle('gen:cancel', (_e, id: string) => cancelGeneration(id));

  ipcMain.handle('dialog:save', async (_e, name: string, data: ArrayBuffer, filterName: string, ext: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: filterName, extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, new Uint8Array(data));
    return r.filePath;
  });
  ipcMain.handle('dialog:open', async (_e, filterName: string, ext: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, { defaultPath: app.getPath('documents'), filters: [{ name: filterName, extensions: [ext] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const buf = await fs.readFile(r.filePaths[0]);
    return { name: path.basename(r.filePaths[0]), data: toArrayBuffer(new Uint8Array(buf)) };
  });
}

/** scenedoll://app/… → 빌드된 화면 파일. 경로가 화면 폴더 밖으로 나가면 거부 */
function registerAppProtocol(): void {
  const root = path.join(app.getAppPath(), 'dist');
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const abs = path.normalize(path.join(root, rel));
    if (!abs.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
}

/** 화면(scenedoll://)에서 NTT 서버 같은 외부 주소를 부를 때 CORS 응답 머리말을 보충한다(우리 화면만 쓰는 창이므로 안전) */
function relaxCorsForRenderer(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const external = /^https?:/.test(details.url) && !details.url.startsWith('http://localhost');
    const fromApp = details.referrer?.startsWith(`${SCHEME}://`) || details.webContents?.getURL().startsWith(`${SCHEME}://`);
    if (!external || !fromApp) return cb({});
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('access-control-')) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
    cb({ responseHeaders: headers, statusLine: details.method === 'OPTIONS' ? 'HTTP/1.1 204 No Content' : details.statusLine });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    title: '씬 돌',
    backgroundColor: '#f4f4f2',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  void mainWindow.loadURL(DEV_URL ?? `${SCHEME}://app/index.html`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void app.whenReady().then(async () => {
    process.env.SCENEDOLL_VERSION = app.getVersion();
    await restoreWorkDir();
    // 시험·무인 실행용: 환경 변수로 작업 폴더를 미리 지정
    if (process.env.SCENEDOLL_WORKDIR) await setWorkDir(process.env.SCENEDOLL_WORKDIR);
    registerIpc();
    registerAppProtocol();
    relaxCorsForRenderer();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
