/**
 * Streaming scanner for the two PTY-output signals Clack cares about:
 * attention bells (BEL outside an escape sequence) and OSC 0/2 window titles
 * (Claude Code continuously retitles the terminal — free status text).
 * Handles sequences split across chunk boundaries; everything else passes by.
 */
export interface PtySignalHandlers {
  onBell?: () => void;
  onTitle?: (title: string) => void;
}

const BEL = 0x07;
const ESC = 0x1b;
const MAX_OSC_BYTES = 4096;

export class PtySignalParser {
  private state: 'text' | 'esc' | 'csi' | 'osc' | 'oscEsc' = 'text';
  private oscBytes: number[] = [];

  constructor(private handlers: PtySignalHandlers) {}

  feed(data: Buffer): void {
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      switch (this.state) {
        case 'text':
          if (b === ESC) this.state = 'esc';
          else if (b === BEL) this.handlers.onBell?.();
          break;
        case 'esc':
          if (b === 0x5d /* ] */) {
            this.state = 'osc';
            this.oscBytes = [];
          } else if (b === 0x5b /* [ */) {
            this.state = 'csi';
          } else {
            this.state = 'text'; // two-byte escape we don't care about
          }
          break;
        case 'csi':
          // skip params/intermediates until the final byte
          if (b >= 0x40 && b <= 0x7e) this.state = 'text';
          break;
        case 'osc':
          if (b === BEL) {
            this.finishOsc(); // BEL as OSC terminator is not an attention bell
          } else if (b === ESC) {
            this.state = 'oscEsc';
          } else if (this.oscBytes.length < MAX_OSC_BYTES) {
            this.oscBytes.push(b);
          }
          break;
        case 'oscEsc':
          // expecting ST (ESC \); anything else means a malformed sequence —
          // emit what we have and re-interpret this byte
          this.finishOsc();
          if (b !== 0x5c /* \ */) this.state = b === ESC ? 'esc' : 'text';
          break;
      }
    }
  }

  private finishOsc(): void {
    this.state = 'text';
    const raw = Buffer.from(this.oscBytes).toString('utf8');
    this.oscBytes = [];
    const m = /^([02]);([\s\S]*)$/.exec(raw);
    if (m && this.handlers.onTitle) this.handlers.onTitle(m[2]);
  }
}
