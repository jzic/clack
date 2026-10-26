import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import App from './App';
import { socket } from './socket';
import { termRegistry } from './termRegistry';
import { handleAppKey } from './shortcuts';
import { useStore, urgentChannels } from './store';
import { activateChannel, redrawAfterReconnect, applyZen, requestFit, handleFileDrop } from './actions';
import { updateBadge } from './favicon';

// ---- wiring (setter injection keeps socket/termRegistry decoupled) ----
termRegistry.sendInput = (id, data) => socket.sendInput(id, data);
termRegistry.sendFlow = (id, action) => socket.send({ type: 'flow', id, action });
termRegistry.onUserActed = (id) => socket.send({ type: 'acted', id });
termRegistry.onKeyEvent = handleAppKey;

socket.onOutput = (id, bytes) => {
  termRegistry.write(id, bytes);
  useStore.getState().bumpActivity(id);
};
socket.onChannelsKnown = (channels, cols, rows) => {
  termRegistry.setSize(cols, rows); // match server width before replay bytes arrive
  for (const ch of channels) termRegistry.ensure(ch.id);
};
socket.onReplay = (id, phase) => {
  if (phase === 'start') termRegistry.reset(id); // replay lands on a clean buffer
};
socket.onChannelAdded = (id) => activateChannel(id); // you just created it — go there
socket.onChannelRemoved = (id) => termRegistry.dispose(id);
socket.onReplaySettled = () => requestAnimationFrame(redrawAfterReconnect);
socket.onZen = (on) => applyZen(on);
socket.connect();

// Register the network-only service worker so Chrome offers "Install as app"
// (own dock icon + badge, standalone window). It caches nothing — see sw.js.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* install prompt just won't appear; the app still works in a tab */
    });
  });
}

// Drive time-based escalation: re-evaluate waiting levels every 15s.
useStore.getState().setNow(Date.now());
setInterval(() => useStore.getState().setNow(Date.now()), 15_000);

window.addEventListener('focus', () => {
  socket.send({ type: 'appFocus', focused: true });
  requestAnimationFrame(requestFit); // this window is now authoritative for the shared size
});
window.addEventListener('blur', () => socket.send({ type: 'appFocus', focused: false }));
window.addEventListener(
  'keydown',
  (e) => {
    if (handleAppKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);
window.addEventListener('beforeunload', (e) => {
  // sessions survive on the server; this only guards against accidental Cmd+W
  if (Object.values(useStore.getState().channels).some((c) => c.ptyAlive)) e.preventDefault();
});

// Dragging a file into Clack should insert its path (native-terminal behavior),
// not let Chrome navigate to the file:// URL and open the PDF. We hijack drops
// anywhere except Clack's own text fields — note xterm's input surface is a
// hidden textarea inside .term-stack, so that IS the terminal, not a Clack field.
function isClackTextField(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t.closest('input, textarea, [contenteditable="true"]') : null;
  return !!el && !el.closest('.term-stack');
}
// A sidebar channel-reorder drag carries this type; leave it to the sidebar.
const isReorderDrag = (e: DragEvent) => !!e.dataTransfer?.types?.includes('application/x-clack-reorder');
window.addEventListener('dragover', (e) => {
  if (isClackTextField(e.target) || isReorderDrag(e)) return; // inputs + reorder drags handle themselves
  e.preventDefault(); // required for 'drop' to fire and to block navigation
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', (e) => {
  if (isClackTextField(e.target) || isReorderDrag(e) || !e.dataTransfer) return;
  e.preventDefault(); // stop Chrome from opening the file
  handleFileDrop(e.dataTransfer);
});

useStore.subscribe((state, prev) => {
  if (state.channels === prev.channels) return;
  // the tab badge counts only *urgent* channels (blocked / errored); calm
  // "ready" answers show green in the sidebar but don't inflate the alarm count
  updateBadge(urgentChannels(state.channels).length);
});
updateBadge(0);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
