import { useWindowDimensions } from 'react-native';
import { layoutInfo, type LayoutInfo } from './layoutClass';

export type { LayoutClass, LayoutInfo } from './layoutClass';
export { classify, isTwoPane, usesSideRail } from './layoutClass';

/** The current window's layout class (plan 21): `useWindowDimensions()` → `classify`. Re-renders on
 *  rotation / window resize. */
export function useLayoutClass(): LayoutInfo {
  const { width, height, fontScale } = useWindowDimensions();
  return layoutInfo(width, height, fontScale);
}
