import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, byIdx } from '../store';
import { termRegistry } from '../termRegistry';
import { requestFit } from '../actions';

/**
 * All terminal panes stay mounted, stacked in the same cell with
 * visibility:hidden when inactive — scrollback and renderer state survive
 * switches, and fit math never sees a 0x0 element.
 */
export function TerminalHost() {
  const ids = useStore(useShallow((s) => byIdx(s.channels).map((c) => c.id)));
  const activeId = useStore((s) => s.activeId);
  const stackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(requestFit, 100);
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeId) termRegistry.setActive(activeId);
    requestAnimationFrame(requestFit);
  }, [activeId, ids.length]);

  return (
    <div className="term-stack" ref={stackRef}>
      {ids.map((id) => (
        <TermPane key={id} id={id} visible={id === activeId} />
      ))}
    </div>
  );
}

function TermPane({ id, visible }: { id: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) termRegistry.open(id, ref.current);
  }, [id]);
  return <div ref={ref} className={visible ? 'term-pane visible' : 'term-pane'} />;
}
