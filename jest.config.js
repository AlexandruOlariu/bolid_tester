/** Two Jest projects (plan 10, see docs/testing.md):
 *  - `core`: the pure-TS engine and store/service logic (`*.test.ts`) under ts-jest in Node — fast,
 *    no React Native runtime.
 *  - `ui`: component tests (`*.test.tsx`) under the `jest-expo` preset with React Native Testing
 *    Library, rendering real screens against the real zustand stores and the simulator.
 *  `npm test` runs both; `npm run test:core` / `npm run test:ui` select one. */

// Resolve the `@/` path alias (tsconfig `paths`); neither ts-jest nor babel-jest reads tsconfig paths.
const alias = { '^@/(.*)$': '<rootDir>/src/$1' };

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'core',
      preset: 'ts-jest',
      testEnvironment: 'node',
      // plugins/ holds the Expo config plugins (e.g. ios-scene-lifecycle) and their unit tests.
      roots: ['<rootDir>/src', '<rootDir>/plugins'],
      testMatch: ['**/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      moduleNameMapper: alias,
      clearMocks: true,
    },
    {
      displayName: 'ui',
      preset: 'jest-expo',
      // test/ holds the shared helpers plus tests that cannot live in src/app (expo-router would treat
      // a `*.test.tsx` there as a route), e.g. the root tab-layout test.
      roots: ['<rootDir>/src', '<rootDir>/test'],
      testMatch: ['**/*.test.tsx'],
      // `@test/` = the shared UI-test helpers in test/ (render wrapper, router mock, simulator).
      moduleNameMapper: { ...alias, '^@test/(.*)$': '<rootDir>/test/$1' },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ui.ts'],
      // npm nests expo-modules-core under expo/ (not hoisted); jest-expo's setup requires it by name.
      modulePaths: ['<rootDir>/node_modules/expo/node_modules'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-modules-core|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-safe-area-context|react-native-screens|tamagui|@tamagui/.*|lucide-react-native|zustand)/)',
      ],
      clearMocks: true,
    },
  ],
};
