import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { launchTemplate, saveTemplate, deleteTemplate } from '../actions';
import { termRegistry } from '../termRegistry';

/** Save the current channel set as a named template, or launch a saved one. */
export function TemplatesModal() {
  const open = useStore((s) => s.templatesOpen);
  const templates = useStore((s) => s.templates);
  const channelCount = useStore((s) => Object.keys(s.channels).length);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const close = () => {
    useStore.getState().setTemplatesOpen(false);
    termRegistry.focusActive();
  };
  const doSave = () => {
    if (!name.trim()) return;
    saveTemplate(name);
    setName('');
  };
  const doLaunch = (t: string) => {
    launchTemplate(t);
    close();
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="modal templates"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <h2>templates</h2>
        {templates.length > 0 ? (
          <div className="tpl-list">
            {templates.map((t) => (
              <div key={t.name} className="tpl-row" onClick={() => doLaunch(t.name)}>
                <div className="tpl-text">
                  <div className="tpl-name">{t.name}</div>
                  <div className="tpl-sub">{t.channels.map((c) => c.name).join(' · ')}</div>
                </div>
                <span className="tpl-count">{t.channels.length}</span>
                <button
                  className="tpl-del"
                  title="delete template"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTemplate(t.name);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="tpl-empty">No templates yet. Save your current {channelCount} channel{channelCount === 1 ? '' : 's'} as one below, then launch it any time.</p>
        )}
        <label className="tpl-save">
          save current set as
          <div className="tpl-save-row">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSave()}
              placeholder="e.g. morning"
              spellCheck={false}
            />
            <button className="primary" onClick={doSave} disabled={!name.trim()}>
              save
            </button>
          </div>
        </label>
        <div className="modal-actions">
          <button onClick={close}>done</button>
        </div>
      </div>
    </div>
  );
}
