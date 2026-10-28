import { contextBridge, ipcRenderer } from 'electron';
import type { SceneDollNative } from '../src/native';

const call = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: SceneDollNative = {
  version: process.env.SCENEDOLL_VERSION ?? '',
  workDir: {
    get: () => call('workdir:get'),
    suggest: () => call('workdir:suggest'),
    choose: () => call('workdir:choose'),
    use: (p) => call('workdir:use', p),
    reveal: () => call('workdir:reveal'),
  },
  fs: {
    readText: (p) => call('fs:readText', p),
    writeText: (p, t) => call('fs:writeText', p, t),
    readBinary: (p) => call('fs:readBinary', p),
    writeBinary: (p, d) => call('fs:writeBinary', p, d),
    list: (d) => call('fs:list', d),
    remove: (p) => call('fs:remove', p),
    exists: (p) => call('fs:exists', p),
  },
  keys: {
    status: () => call('keys:status'),
    set: (id, key) => call('keys:set', id, key),
    clear: (id) => call('keys:clear', id),
  },
  generate: {
    run: (req) => call('gen:run', req),
    cancel: (id) => call('gen:cancel', id),
  },
  dialog: {
    saveFile: (name, data, filterName, ext) => call('dialog:save', name, data, filterName, ext),
    openFile: (filterName, ext) => call('dialog:open', filterName, ext),
  },
};

contextBridge.exposeInMainWorld('sceneDollNative', api);
