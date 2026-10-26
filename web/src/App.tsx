import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { Main } from './components/Main';
import { QuickSwitcher } from './components/QuickSwitcher';
import { NewChannelModal } from './components/NewChannelModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SearchOverlay } from './components/SearchOverlay';
import { TemplatesModal } from './components/TemplatesModal';
import { SparksOverlay } from './components/SparksOverlay';
import { CaptureBar } from './components/CaptureBar';
import { Toast } from './components/Toast';
import { Wall } from './components/Wall';

export default function App() {
  const connected = useStore((s) => s.connected);
  const everConnected = useStore((s) => s.everConnected);
  const wallOpen = useStore((s) => s.wallOpen);
  return (
    <div className="app">
      {!connected && (
        <div className="conn-banner">{everConnected ? 'reconnecting to clack-server…' : 'connecting…'}</div>
      )}
      <Sidebar />
      <Main />
      {/* drawn OVER the terminal view, which stays mounted and sized underneath */}
      {wallOpen && <Wall />}
      <QuickSwitcher />
      <NewChannelModal />
      <ConfirmDialog />
      <SearchOverlay />
      <TemplatesModal />
      <SparksOverlay />
      <CaptureBar />
      <Toast />
    </div>
  );
}
