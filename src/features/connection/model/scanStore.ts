import { create } from 'zustand';

export interface ScannedDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  isLikelyAdapter: boolean;
}

interface ScanState {
  scanning: boolean;
  devices: ScannedDevice[];
  setScanning: (v: boolean) => void;
  upsert: (d: ScannedDevice) => void;
  clear: () => void;
}

export const useScanStore = create<ScanState>((set) => ({
  scanning: false,
  devices: [],
  setScanning: (scanning) => set({ scanning }),
  upsert: (d) =>
    set((s) => {
      const i = s.devices.findIndex((x) => x.id === d.id);
      if (i === -1) return { devices: [...s.devices, d] };
      const next = s.devices.slice();
      next[i] = d;
      return { devices: next };
    }),
  clear: () => set({ devices: [] }),
}));
