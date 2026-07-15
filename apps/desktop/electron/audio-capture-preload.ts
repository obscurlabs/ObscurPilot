import { contextBridge, ipcRenderer } from 'electron';

const COMMAND_CHANNEL = 'audio-internal:command:v1';
const EVENT_CHANNEL = 'audio-internal:event:v1';

contextBridge.exposeInMainWorld(
  'obscurPilotAudio',
  Object.freeze({
    onCommand: (listener: (command: unknown) => void) => {
      ipcRenderer.on(COMMAND_CHANNEL, (_event, command) => listener(command));
    },
    emit: (event: unknown) => ipcRenderer.send(EVENT_CHANNEL, event),
  }),
);
