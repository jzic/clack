import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { createChannel } from '../actions';
import { termRegistry } from '../termRegistry';

export function NewChannelModal() {
  const open = useStore((s) => s.newChannelOpen);
  const [cwd, setCwd] = useState('~/Code/');
  const [name, setName] = useState('');
  const [runClaude, setRunClaude] = useState(true);
  const cwdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => cwdRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const close = () => {
    useStore.getState().setNewChannelOpen(false);
    termRegistry.focusActive();
  };
  const derivedName = name.trim() || cwd.replace(/\/+$/, '').split('/').pop() || 'channel';
  const submit = () => {
    if (!cwd.trim()) return;
    createChannel(derivedName, cwd.trim(), runClaude ? 'claude' : undefined);
    close();
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter') submit();
        }}
      >
        <h2>new channel</h2>
        <label>
          project folder
          <input
            ref={cwdRef}
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="~/Code/my-project"
            spellCheck={false}
          />
        </label>
        <label>
          channel name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={derivedName} spellCheck={false} />
        </label>
        <label className="check">
          <input type="checkbox" checked={runClaude} onChange={(e) => setRunClaude(e.target.checked)} />
          <span>
            run <code>claude</code> on start
          </span>
        </label>
        <div className="modal-actions">
          <button onClick={close}>cancel</button>
          <button className="primary" onClick={submit}>
            create
          </button>
        </div>
      </div>
    </div>
  );
}
