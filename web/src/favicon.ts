/** Dynamic favicon + title badge: the browser-tab version of a dock badge.
 *  When Clack is installed as an app (PWA), also drive the real dock badge. */

let link: HTMLLinkElement | undefined;

export function updateBadge(needsCount: number): void {
  document.title = needsCount > 0 ? `(${needsCount}) Clack` : 'Clack';

  // Real dock/taskbar badge on the installed app. No-op in a plain browser tab;
  // the returned promise can reject if unsupported, so swallow it.
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (nav.setAppBadge) {
    const p = needsCount > 0 ? nav.setAppBadge(needsCount) : nav.clearAppBadge?.();
    p?.catch(() => {});
  }
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#0b0d10';
  roundRect(ctx, 0, 0, 32, 32, 7);
  ctx.fill();

  if (needsCount > 0) {
    ctx.fillStyle = '#ff5d52';
    roundRect(ctx, 0, 0, 32, 32, 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(needsCount > 9 ? '9+' : String(needsCount), 16, 18);
  } else {
    ctx.fillStyle = '#e8695a'; // the resting wordmark cursor
    ctx.fillRect(11, 8, 10, 16);
  }

  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = canvas.toDataURL('image/png');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
