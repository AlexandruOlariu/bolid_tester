/** `useWindowDimensions` test double for the `ui` Jest project (wired in jest.setup.ui.ts). React
 *  Native's own jest mock reports a 750 × 1334 window — a "medium" layout class (plan 21) — so every
 *  screen test would render the tablet layouts. The double defaults to a portrait phone instead
 *  (390 × 844 dp); a test that wants a tablet or a landscape phone calls `setMockWindow` before it
 *  renders. `resetStores` puts the phone back before every test. */
export interface MockWindow {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}

export const PHONE_WINDOW: MockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
/** Pixel Tablet in landscape: 2560 × 1600 px at 320 dpi. */
export const TABLET_WINDOW: MockWindow = { width: 1280, height: 800, scale: 2, fontScale: 1 };

let current: MockWindow = PHONE_WINDOW;

export function setMockWindow(size: Partial<MockWindow>): void {
  current = { ...current, ...size };
}

export function resetMockWindow(): void {
  current = PHONE_WINDOW;
}

export function mockUseWindowDimensions(): MockWindow {
  return current;
}
