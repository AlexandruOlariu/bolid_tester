module.exports = function (api) {
  api.cache(true);
  // Jest (the `ui` project, jest-expo preset) runs Tamagui at runtime; the optimizing compiler would
  // only add a slow static-extraction pass per transformed file, so it is skipped under test.
  const isTest = process.env.NODE_ENV === 'test';
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: isTest
      ? []
      : [
          // Tamagui optimizing compiler (optional but recommended).
          [
            '@tamagui/babel-plugin',
            {
              components: ['tamagui'],
              config: './tamagui.config.ts',
              logTimings: true,
              disableExtraction: process.env.NODE_ENV === 'development',
            },
          ],
        ],
  };
};
