import { contextBridge, ipcRenderer } from 'electron';
// Imported from the dependency-free entry point: the preload runs sandboxed and
// must never pull Zod or any Node-only module into its bundle.
import { IPC_CHANNELS } from '@klymon/shared-types/ipc';
import type {
  KlymonBridge,
  IpcChannel,
  IpcContract,
  IpcEventMap,
  IpcEventName,
} from '@klymon/shared-types/ipc';

const allowedChannels = new Set<string>(IPC_CHANNELS);

/**
 * The renderer gets exactly two capabilities: invoke a whitelisted channel and
 * subscribe to push events. No Node APIs, no filesystem, no shell.
 */
const bridge: KlymonBridge = {
  invoke: async <K extends IpcChannel>(channel: K, payload?: IpcContract[K]['req']) => {
    if (!allowedChannels.has(channel)) {
      throw new Error(JSON.stringify({ code: 'FORBIDDEN', message: `Channel ${channel} is not allowed.` }));
    }
    return (await ipcRenderer.invoke(channel, payload)) as IpcContract[K]['res'];
  },
  on: <K extends IpcEventName>(event: K, listener: (payload: IpcEventMap[K]) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: IpcEventMap[K]): void => listener(payload);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('klymon', bridge);
