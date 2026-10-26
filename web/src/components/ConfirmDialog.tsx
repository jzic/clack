import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { confirmRemove } from '../actions';
import { termRegistry } from '../termRegistry';

/** In-app replacement for window.confirm on channel close. */
export function ConfirmDialog() {
  const pending = useStore((s) => s.confirmClose);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending) setTimeout(() => closeBtn.current?.focus(), 0);
  }, [pending]);

  if (!pending) return null;

  const cancel = () => {
    useStore.getState().setConfirmClose(null);
    termRegistry.focusActive();
  };

  return (
    <div className="overlay" onMouseDown={cancel}>
      <div
        className="modal confirm"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
        }}
      >
        <h2>close #{pending.name}?</h2>
        <p className="confirm-body">
          This kills the channel's shell and anything running in it. A Claude session there can be brought back with{' '}
          <code>claude --continue</code>.
        </p>
        <div className="modal-actions">
          <button onClick={cancel}>cancel</button>
          <button ref={closeBtn} className="danger" onClick={confirmRemove}>
            close channel
          </button>
        </div>
      </div>
    </div>
  );
}
