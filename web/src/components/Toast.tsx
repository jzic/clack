import { useStore } from '../store';

/** Ephemeral confirmation (e.g. "💡 saved to #api-server"). Auto-clears; see showToast. */
export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}
