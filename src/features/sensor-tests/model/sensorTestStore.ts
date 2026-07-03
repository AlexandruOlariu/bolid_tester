import { create } from 'zustand';
import type { Mode06Result, Mode05Result } from '@/shared/obd-core';

export interface ModuleReading {
  name: string;
  unit: string;
  value: number | null;
  raw: string;
}

interface SensorTestState {
  mode06: Mode06Result[];
  mode05: Mode05Result[];
  moduleReadings: ModuleReading[];
  setMode06: (r: Mode06Result[]) => void;
  setMode05: (r: Mode05Result[]) => void;
  setModuleReadings: (r: ModuleReading[]) => void;
}

export const useSensorTestStore = create<SensorTestState>((set) => ({
  mode06: [],
  mode05: [],
  moduleReadings: [],
  setMode06: (mode06) => set({ mode06 }),
  setMode05: (mode05) => set({ mode05 }),
  setModuleReadings: (moduleReadings) => set({ moduleReadings }),
}));
