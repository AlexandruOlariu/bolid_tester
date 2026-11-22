/** expo-router test double for the `ui` Jest project (wired in jest.setup.ui.ts). Screens call
 *  `useRouter().push(...)`; tests assert on `mockPush` to check navigation without a navigator. */
import React from 'react';

export const mockPush = jest.fn();
export const mockReplace = jest.fn();
export const mockBack = jest.fn();
export const mockSetParams = jest.fn();

const router = {
  push: mockPush,
  navigate: mockPush,
  replace: mockReplace,
  back: mockBack,
  canGoBack: () => false,
  setParams: mockSetParams,
};

/** What `useIsFocused()` returns (default focused; reset by `resetStores`). */
export let mockFocused = true;
export function setMockFocused(focused: boolean): void {
  mockFocused = focused;
}

/** Search params a test wants a screen to see (set before render, reset by `resetStores`). */
export let mockSearchParams: Record<string, string | undefined> = {};
export function setMockSearchParams(params: Record<string, string | undefined>): void {
  mockSearchParams = params;
}

interface TabScreenProps {
  name: string;
  options?: { title?: string; href?: string | null };
}

/** `<Tabs.Screen>` renders nothing by itself; `<Tabs>` records its `screenOptions`
 *  (`lastTabsScreenOptions`) and renders a stand-in tab bar so a layout test can assert it: each visible tab as a `Text` (testID `tab-<route>`) showing its title — or the bare
 *  route name when the title is missing, as the real tab bar would — and each hidden `href: null`
 *  route as an empty `View` (testID `hidden-<route>`). */
function TabScreen(_props: TabScreenProps): null {
  return null;
}

/** The `screenOptions` the last rendered `<Tabs>` received (the side rail, plan 21). */
export let lastTabsScreenOptions: Record<string, unknown> = {};

function Tabs({
  children,
  screenOptions,
}: {
  children?: React.ReactNode;
  screenOptions?: Record<string, unknown>;
}): React.ReactElement {
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  lastTabsScreenOptions = screenOptions ?? {};
  const screens: TabScreenProps[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement<TabScreenProps>(child) && child.type === TabScreen) {
      screens.push(child.props);
    }
  });
  return React.createElement(
    View,
    { testID: 'tabs-root' },
    screens.map((s) =>
      s.options?.href === null
        ? React.createElement(View, { key: s.name, testID: `hidden-${s.name}` })
        : React.createElement(
            Text,
            { key: s.name, testID: `tab-${s.name}` },
            s.options?.title ?? s.name,
          ),
    ),
  );
}
Tabs.Screen = TabScreen;

export const expoRouterMock = {
  useRouter: () => router,
  router,
  useLocalSearchParams: () => mockSearchParams,
  useGlobalSearchParams: () => mockSearchParams,
  useIsFocused: () => mockFocused,
  useSegments: () => [],
  usePathname: () => '/',
  useFocusEffect: (effect: () => void | (() => void)) => {
    React.useEffect(effect, [effect]);
  },
  useNavigation: () => ({ setParams: mockSetParams, addListener: () => () => undefined }),
  Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Redirect: () => null,
  Stack: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
    Screen: () => null,
  }),
  Tabs,
};
