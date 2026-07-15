// electron/audio-capture-preload.ts
var import_electron = require("electron");
var COMMAND_CHANNEL = "audio-internal:command:v1";
var EVENT_CHANNEL = "audio-internal:event:v1";
import_electron.contextBridge.exposeInMainWorld(
  "obscurPilotAudio",
  Object.freeze({
    onCommand: (listener) => {
      import_electron.ipcRenderer.on(COMMAND_CHANNEL, (_event, command) => listener(command));
    },
    emit: (event) => import_electron.ipcRenderer.send(EVENT_CHANNEL, event)
  })
);
