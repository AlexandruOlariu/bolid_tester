import { create } from 'zustand';
import type { Mode06Result } from '@/shared/obd-core';

export interface ModuleReading {
  name: string;
  unit: string;
  value: number | null;
  raw: string;
}

interface SensorTestState {
  mode06: Mode06Result[];
  moduleReadings: ModuleReading[];
  setMode06: (r: Mode06Result[]) => void;
  setModuleReadings: (r: ModuleReading[]) => void;
}

export const useSensorTestStore = create<SensorTestState>((set) => ({
  mode06: [],
  moduleReadings: [],
  setMode06: (mode06) => set({ mode06 }),
  setModuleReadings: (moduleReadings) => set({ moduleReadings }),
}));
