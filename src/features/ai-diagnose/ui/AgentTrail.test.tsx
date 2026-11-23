/** The agent trail's step labels: a skill step shows the skill's translated name, not its id. */
import React from 'react';
import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import type { TrailRow } from '@/shared/state/historyStore';
import { AgentTrail } from './AgentTrail';

const row = (id: number, name: string): TrailRow => ({
  id,
  kind: 'tool',
  tool: 'run_skill',
  why: '',
  digest: '',
  summary: '',
  label: { key: 'aiDiagnose:agent.tool.run_skill', values: { name } },
  status: 'ok',
});

it('shows a skill step by its translated name, and an unknown skill with spaces', () => {
  renderWithProviders(
    <AgentTrail
      trail={[row(2, 'used_car_check'), row(3, 'battery_charging'), row(4, 'some_new_skill')]}
      running={false}
      stepsUsed={3}
      maxSteps={12}
      onStop={() => {}}
      collapsible={false}
    />,
  );
  expect(screen.getByText('Ran the used-car check')).toBeTruthy();
  expect(screen.getByText('Ran the battery and charging check')).toBeTruthy();
  expect(screen.getByText('Ran the some new skill check')).toBeTruthy();
  expect(screen.queryByText(/used_car_check/)).toBeNull();
});

it('every skill file has a translated name in en and ro', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = path.resolve(__dirname, '../../..');
  const names: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.skill.json'))
        names.push((JSON.parse(fs.readFileSync(p, 'utf8')) as { name: string }).name);
    }
  };
  walk(root);
  expect(names.length).toBeGreaterThanOrEqual(38);
  for (const lang of ['en', 'ro']) {
    const locale = JSON.parse(
      fs.readFileSync(path.join(root, `shared/i18n/locales/${lang}/aiDiagnose.json`), 'utf8'),
    ) as { agent: { skillName: Record<string, string> } };
    for (const n of names)
      expect([lang, n, typeof locale.agent.skillName[n]]).toEqual([lang, n, 'string']);
  }
});
