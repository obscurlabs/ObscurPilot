import { contextBridge, ipcRenderer } from 'electron';
import { createRendererApi } from './preload-api.js';

contextBridge.exposeInMainWorld('obscurPilot', createRendererApi(ipcRenderer));
