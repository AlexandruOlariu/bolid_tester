import { readFileSync } from 'fs';
import { join } from 'path';

type Prop = { type: 'property'; key: string; value: string } | { type: 'comment'; value: string };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('./withGradleMemory') as {
  applyGradleMemory: (props: Prop[]) => Prop[];
  JVM_ARGS: string;
};
const { applyGradleMemory, JVM_ARGS } = plugin;

const jvmArgs = (props: Prop[]) =>
  props.filter(
    (p): p is Extract<Prop, { type: 'property' }> =>
      p.type === 'property' && p.key === 'org.gradle.jvmargs',
  );

// The relevant part of the gradle.properties that `expo prebuild` generates for Expo SDK 57.
const TEMPLATE: Prop[] = [
  { type: 'comment', value: ' Specifies the JVM arguments used for the daemon process.' },
  { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
  { type: 'property', key: 'org.gradle.parallel', value: 'true' },
  { type: 'property', key: 'android.useAndroidX', value: 'true' },
];

describe('withGradleMemory', () => {
  it('raises the heap and metaspace the template sets too low for SDK 57', () => {
    expect(JVM_ARGS).toBe(
      '-Xmx4096m -XX:MaxMetaspaceSize=1536m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
    );
    const out = applyGradleMemory(TEMPLATE);
    expect(jvmArgs(out)).toEqual([
      { type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS },
    ]);
  });

  it('replaces the key in place and leaves every other entry alone', () => {
    const out = applyGradleMemory(TEMPLATE);
    expect(out).toHaveLength(TEMPLATE.length);
    expect(out.map((p) => (p.type === 'property' ? p.key : '#'))).toEqual([
      '#',
      'org.gradle.jvmargs',
      'org.gradle.parallel',
      'android.useAndroidX',
    ]);
    expect(out[0]).toBe(TEMPLATE[0]);
    expect(out[2]).toBe(TEMPLATE[2]);
    expect(TEMPLATE[1]).toMatchObject({ value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' }); // input untouched
  });

  it('never leaves two jvmargs keys, and is idempotent', () => {
    const duplicated: Prop[] = [
      ...TEMPLATE,
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx1g' },
    ];
    const once = applyGradleMemory(duplicated);
    expect(jvmArgs(once)).toHaveLength(1);
    expect(applyGradleMemory(once)).toEqual(once);
  });

  it('adds the key when the template has none', () => {
    const out = applyGradleMemory([
      { type: 'property', key: 'android.useAndroidX', value: 'true' },
    ]);
    expect(jvmArgs(out)).toEqual([
      { type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS },
    ]);
  });

  it('is registered in app.json before the release-signing plugin, which stays last', () => {
    const plugins = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')).expo
      .plugins as unknown[];
    const names = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('./plugins/withGradleMemory');
    expect(names[names.length - 1]).toBe('./plugins/withReleaseSigning');
    expect(names.indexOf('./plugins/withGradleMemory')).toBeLessThan(names.length - 1);
  });
});
