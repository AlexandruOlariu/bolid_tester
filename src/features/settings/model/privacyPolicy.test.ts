import { readFileSync } from 'fs';
import { join } from 'path';
import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED } from './privacyPolicy';

const doc = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'docs', 'privacy-policy.md'),
  'utf8',
);

/** Markdown → comparable plain text: drop list markers and emphasis, collapse whitespace. */
const plain = (s: string) =>
  s
    .replace(/^\s*-\s+/gm, '')
    .replace(/\*\*|`|_/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('privacy policy (Settings → About ↔ docs/privacy-policy.md)', () => {
  it('has the same section headings, in the same order', () => {
    const docHeadings = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    expect(docHeadings).toEqual(PRIVACY_POLICY.map((s) => s.heading));
  });

  it('every in-app paragraph appears verbatim in the published policy', () => {
    const docText = plain(doc);
    for (const section of PRIVACY_POLICY) {
      for (const p of section.paragraphs) expect(docText).toContain(plain(p));
    }
  });

  it('says app error messages go to the AI with VINs masked (scrubText keeps the last 5), not removed', () => {
    const all = plain(PRIVACY_POLICY.flatMap((s) => s.paragraphs).join(' '));
    expect(all).toContain('recent app error messages (with VINs masked and addresses removed)');
    expect(all).not.toContain('VINs and addresses removed');
  });

  it('carries the same "last updated" date', () => {
    expect(PRIVACY_POLICY_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc).toContain(`Last updated: ${PRIVACY_POLICY_UPDATED}`);
  });

  it('names every network destination the app can reach', () => {
    const all = plain(PRIVACY_POLICY.flatMap((s) => s.paragraphs).join(' '));
    expect(all).toContain('AI assistant');
    expect(all).toContain('Expo update server');
    expect(all).toContain('Search the web');
    expect(all).toMatch(/no analytics/);
    // Plan 31: the crash-reporting service, opt-in.
    expect(all).toContain('Sentry');
    expect(all).toContain('Crash reports are off unless you turn on');
  });

  it('describes crash reports: what is removed, where they go, retention and withdrawal (plan 31)', () => {
    const section = PRIVACY_POLICY.find((s) => s.heading === 'Crash reports (optional)');
    expect(section).toBeDefined();
    const text = plain(section!.paragraphs.join(' '));
    expect(text).toMatch(/EU region/);
    expect(text).toMatch(/removes VINs, adapter names and addresses, server addresses, API keys/);
    // Native crashes bypass the JS scrubber; the policy must say so rather than promise otherwise.
    expect(text).toMatch(/system code or a built-in library is reported .* without that clean-up/);
    expect(text).toMatch(/90 days/);
    expect(text).toMatch(/consent/);
    expect(text).toMatch(/turning the switch off/);
  });

  it('the AI paragraph lists what the agent sends (plan 34d)', () => {
    const ai = PRIVACY_POLICY.flatMap((s) => s.paragraphs).find((p) =>
      p.startsWith('AI assistant:'),
    )!;
    for (const w of [
      'each investigation step',
      'part numbers',
      'recorded trip values',
      'the maintenance log',
      'past diagnoses',
      'recent app error messages',
      'your answers to the on-screen driver steps',
    ])
      expect(ai).toContain(w);
  });

  it('describes Send to Claude / ChatGPT and the VIN switch (plan 34d)', () => {
    const all = PRIVACY_POLICY.flatMap((s) => s.paragraphs).join(' ');
    expect(all).toContain('Send to Claude / ChatGPT');
    expect(all).toContain('The VIN is left out unless you turn on Include VIN');
  });
});
