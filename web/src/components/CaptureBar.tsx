import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { submitSpark } from '../actions';
import { termRegistry } from '../termRegistry';

/**
 * Quick-jot bar — opens on ⌘I. Multi-line so you can append your own take under
 * a captured Claude block. Enter saves; Shift+Enter adds a newline; Esc cancels.
 */
export function CaptureBar() {
  const target = useStore((s) => s.captureFor);
  const [val, setVal] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (target) {
      setVal(target.prefill ?? '');
      // focus + select-all: Enter keeps the clipboard prefill, typing replaces it
      setTimeout(() => {
        ref.current?.focus();
        ref.current?.select();
      }, 0);
    }
  }, [target]);

  if (!target) return null;

  const close = () => {
    useStore.getState().setCaptureFor(null);
    termRegistry.focusActive();
  };

  const rows = Math.min(10, Math.max(1, val.split('\n').length));

  return (
    <div className="overlay capture-overlay" onMouseDown={close}>
      <div className="capture-bar" onMouseDown={(e) => e.stopPropagation()}>
        <span className="capture-spark">💡</span>
        <textarea
          ref={ref}
          className="capture-input"
          value={val}
          rows={rows}
          placeholder={`jot a spark for #${target.channelName}…  (Shift+Enter for a new line)`}
          spellCheck={false}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitSpark(val);
              termRegistry.focusActive();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
        />
        {target.context && <span className="capture-context">{target.context}</span>}
      </div>
    </div>
  );
}
