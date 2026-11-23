/** AI Diagnose with the development mock server (`mock://ai`, plans 19 and 34a): the simulator Golf
 *  with injected codes, the agent run's trail (Check everything, Investigate a symptom, Stop, the
 *  driver prompt), an AI-sourced report whose findings cite their steps and carry the Golf fault
 *  guides (note + deep-link buttons), Clear codes and the bounded follow-up conversation. No
 *  network: the dispatcher serves the scripted mock client in this (development) test build. */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { mockPush, setMockSearchParams } from '@test/mocks/router';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useHistoryStore, type AiHistoryEntry } from '@/shared/state/historyStore';
import { faultCodesAgentTools } from '@/features/fault-codes';
import { liveDataAgentTools } from '@/features/live-data';
import { batteryHealthAgentTools } from '@/features/battery-health';
import { useAiDiagnoseStore } from '../model/aiDiagnoseStore';
import * as diagnoseService from '../api/diagnoseService';
import * as agentService from '../api/agentService';
import { AiDiagnoseScreen } from './AiDiagnoseScreen';
import { AiReportView } from './AiReportView';

const GOLF = 'golf-plus-2009-20tdi';

function useMockAi() {
  useSettingsStore.setState((s) => ({
    ai: { ...s.ai, enabled: true, provider: 'custom', baseUrl: 'mock://ai', model: '' },
  }));
}

async function runDiagnosis() {
  await act(async () => {
    fireEvent.press(screen.getByText('Check everything'));
  });
  return screen.findByText(/Mock AI report/);
}

/** Press the report's red Clear action, then "Clear" in the confirmation alert. */
async function confirmClear() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
    void buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
  try {
    await act(async () => {
      fireEvent.press(screen.getByText('Clear fault codes'));
    });
  } finally {
    alert.mockRestore();
  }
}

/** Press a suggestion chip (the chips render above the bubbles, which may repeat the text). */
async function ask(question: string) {
  await act(async () => {
    fireEvent.press(screen.getAllByText(question)[0]);
  });
}

describe('AiDiagnoseScreen with mock://ai', () => {
  beforeEach(() => {
    mockPush.mockClear();
    useVehicleStore.setState({ selectedProfileId: GOLF });
  });

  it('cites the Golf fault guides under the findings and lists them to the model', async () => {
    useMockAi();
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401', 'P2015'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await runDiagnosis();

    expect(screen.getByText('AI analysis')).toBeTruthy();
    expect(screen.getByText('P0401 needs a look (mock)')).toBeTruthy();
    expect(screen.getByText('P2015 needs a look (mock)')).toBeTruthy();
    expect(screen.getByText(/Known check for this car: EGR flow\/position fault/)).toBeTruthy();
    expect(screen.getByText(/Known check for this car: Intake manifold runner\/flap/)).toBeTruthy();
    // P0401: EGR position + EGR output test; P2015: flap position (measuring blocks) + V157 setting.
    expect(screen.getAllByText('Open routine')).toHaveLength(2);
    const related = screen.getAllByText('Related data');
    expect(related).toHaveLength(2);
    fireEvent.press(related[1]);
    expect(mockPush).toHaveBeenCalledWith('/extended?dids=170E%2C170F');
    fireEvent.press(screen.getAllByText('Open routine')[0]);
    expect(mockPush).toHaveBeenCalledWith('/routines');

    // gatherSnapshot collected the curated guides for the prompt ("Known checks for this car").
    const guides = useAiDiagnoseStore.getState().snapshot?.guides ?? [];
    expect(guides.map((g) => g.code)).toEqual(['P0401', 'P2015']);
  });

  it('a suggested question appends a question and an answer bubble', async () => {
    useMockAi();
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await runDiagnosis();

    expect(screen.getByText('Ask about this report')).toBeTruthy();
    expect(screen.getByText('What does P0401 mean for this car?')).toBeTruthy();
    await ask('What should I check first?');

    expect(
      await screen.findByText(/Mock answer 1: you asked "What should I check first\?"/),
    ).toBeTruthy();
    expect(screen.getAllByTestId('followup-question')).toHaveLength(1);
    expect(screen.getAllByTestId('followup-answer')).toHaveLength(1);

    // Free text works too; then Clear empties the conversation.
    fireEvent.changeText(screen.getByLabelText('Follow-up question'), 'Can I still drive it?');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send the question'));
    });
    expect(
      await screen.findByText(/Mock answer 2: you asked "Can I still drive it\?"/),
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Clear the conversation'));
    expect(screen.queryAllByTestId('followup-answer')).toHaveLength(0);
  });

  it('the prompt keeps only the last 8 messages: the 6th question no longer sees the 1st', async () => {
    useMockAi();
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await runDiagnosis();

    const questions = [
      'What should I check first?',
      'Is it safe to drive?',
      'Which finding is most urgent?',
      'What does P0401 mean for this car?',
      'What should I check first?',
      'Is it safe to drive?',
    ];
    for (const q of questions) await ask(q);

    // The whole conversation stays on screen…
    const conversation = useAiDiagnoseStore.getState().conversation;
    expect(conversation).toHaveLength(12);
    expect(screen.getAllByTestId('followup-answer')).toHaveLength(6);
    // …but each prompt carries at most MAX_FOLLOWUP_TURNS (8) earlier messages. The mock numbers
    // its answer by the questions it can see: the 5th prompt still holds questions 1–4, the 6th
    // has dropped question 1 (and its answer), so it also sees only 5.
    expect(conversation[9].content).toMatch(/^Mock answer 5:/);
    expect(conversation[11].content).toMatch(/^Mock answer 5:/);
  });

  it('an answer that lands after a re-run is dropped, not added to the new report', async () => {
    useMockAi();
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await runDiagnosis();

    let answer: (text: string) => void = () => {};
    const spy = jest.spyOn(diagnoseService, 'followUp').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    try {
      await ask('What should I check first?');
      expect(useAiDiagnoseStore.getState().asking).toBe(true);
      // A new report arrives (re-run / recheck) while the question is still in flight.
      const old = useAiDiagnoseStore.getState().report!;
      await act(async () => {
        useAiDiagnoseStore.getState().setReport({ ...old, summary: 'Newer report' }, null);
      });
      await act(async () => {
        answer('Late answer about the old report');
      });
      expect(useAiDiagnoseStore.getState().conversation).toEqual([]);
      expect(useAiDiagnoseStore.getState().asking).toBe(false);
      expect(screen.queryByText('Late answer about the old report')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('an "Explain with AI" focus puts its question first', async () => {
    useMockAi();
    setMockSearchParams({ focus: 'P2015' });
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401', 'P2015'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await screen.findByText(/Mock AI report/);

    const chips = screen.getAllByText(/^What does P\d{4} mean for this car\?$/);
    expect(chips).toHaveLength(1);
    expect(screen.getByText('What does P2015 mean for this car?')).toBeTruthy();
  });
});

describe('AiDiagnoseScreen with the on-device report', () => {
  it('disables follow-ups with the explanatory hint', async () => {
    // No AI server configured → local rule-based report.
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401'] });
    useVehicleStore.setState({ selectedProfileId: GOLF });
    renderWithProviders(<AiDiagnoseScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Check everything'));
    });
    expect(await screen.findByText('On-device rule-based analysis')).toBeTruthy();
    expect(screen.getByText(/Follow-up questions need an AI provider/)).toBeTruthy();
    expect(screen.queryByLabelText('Follow-up question')).toBeNull();
    expect(screen.queryByText('What should I check first?')).toBeNull();
    // The local finding for the code still cites the Golf guide.
    expect(screen.getByText(/Known check for this car: EGR flow\/position fault/)).toBeTruthy();
  });

  it('a symptom without AI checks everything and says why', async () => {
    useSettingsStore.setState((s) => ({ ai: { ...s.ai, enabled: false } }));
    await connectSimulator();
    // core only: the sweep has nothing to run, so no driver prompt blocks the test
    renderWithProviders(<AiDiagnoseScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/pulls weak/), 'pulls weak');
    await act(async () => {
      fireEvent.press(screen.getByText('Investigate'));
    });
    expect(
      await screen.findByText(/Understanding a described symptom needs an AI provider/),
    ).toBeTruthy();
    expect(screen.getByText('On-device rule-based analysis')).toBeTruthy();
  });
});

describe('AiDiagnoseScreen agent run with mock://ai', () => {
  beforeEach(() => {
    useVehicleStore.setState({ selectedProfileId: GOLF });
  });

  it('Check everything with mock://ai shows the trail and a cited report', async () => {
    useMockAi();
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401'] });
    renderWithProviders(
      <AiDiagnoseScreen
        contributions={[faultCodesAgentTools, liveDataAgentTools, batteryHealthAgentTools]}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByText('Check everything'));
    });
    expect(await screen.findByText(/Mock AI report/)).toBeTruthy();
    expect(screen.getByText(/Triage — 1 code, battery 12.3 V/)).toBeTruthy();
    expect(screen.getAllByText(/Based on: steps 1/).length).toBeGreaterThan(0);
  });

  it("after the run the trail shows each step's data and collapses", async () => {
    useMockAi();
    await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0401'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await runDiagnosis();
    expect(screen.getAllByTestId('agent-step')).toHaveLength(2);
    expect(screen.getByText('Check the idle readings.')).toBeTruthy();
    fireEvent.press(screen.getAllByText('Show data')[0]);
    expect(screen.getByText('Hide data')).toBeTruthy();
    expect(screen.queryByText('Stop')).toBeNull();
    fireEvent.press(screen.getByText('Investigation · 2 steps'));
    expect(screen.queryAllByTestId('agent-step')).toHaveLength(0);
  });

  it('Investigate is disabled until a symptom is typed', async () => {
    useMockAi();
    await connectSimulator();
    renderWithProviders(<AiDiagnoseScreen />);
    expect(screen.getByRole('button', { name: 'Investigate' })).toBeDisabled();
    fireEvent.changeText(screen.getByPlaceholderText(/pulls weak/), 'rough idle');
    expect(screen.getByRole('button', { name: 'Investigate' })).toBeEnabled();
  });

  it('Stop ends a looping run with the rule report and a notice', async () => {
    useMockAi();
    await connectSimulator();
    renderWithProviders(<AiDiagnoseScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/pulls weak/), 'mock:loop');
    await act(async () => {
      fireEvent.press(screen.getByText('Investigate'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByText('Stop'));
    });
    expect(await screen.findByText('On-device rule-based analysis')).toBeTruthy();
    expect(screen.getByText(/stopped/i)).toBeTruthy();
  });

  it("a battery symptom asks the driver to restart; Can't still finishes", async () => {
    useMockAi();
    await connectSimulator();
    const onDriverAnswer = jest.fn();
    renderWithProviders(
      <AiDiagnoseScreen
        contributions={[batteryHealthAgentTools]}
        onDriverAnswer={onDriverAnswer}
      />,
    );
    fireEvent.changeText(screen.getByPlaceholderText(/pulls weak/), 'battery dies overnight');
    await act(async () => {
      fireEvent.press(screen.getByText('Investigate'));
    });
    // battery_capture samples the resting voltage for 2 s before it opens the prompt
    expect(
      await screen.findByText(
        'Switch the engine off, then start it again.',
        {},
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText("Can't"));
    });
    // The route hears each answer (plan 34c: the simulator's rev hold starts on one).
    expect(onDriverAnswer).toHaveBeenCalledWith('restart_engine', { kind: 'cant' });
    // battery_capture samples real time (2 s before, 4 s after the answer)
    expect(await screen.findByText(/Mock AI report/, {}, { timeout: 10_000 })).toBeTruthy();
  }, 20_000);

  it('pressing Check everything twice starts one run', async () => {
    useMockAi();
    await connectSimulator();
    renderWithProviders(<AiDiagnoseScreen />);
    const spy = jest.spyOn(agentService, 'startAgentRun');
    await act(async () => {
      fireEvent.press(screen.getByText('Check everything'));
      fireEvent.press(screen.getByText('Check everything'));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    // Let the one run finish before the test's session is closed.
    expect(await screen.findByText(/Mock AI report/)).toBeTruthy();
    spy.mockRestore();
  });

  it('Clear codes re-runs triage only', async () => {
    useMockAi();
    await connectSimulator({ injectedDtcs: ['P0401'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Check everything'));
    });
    await screen.findByText(/Mock AI report/);
    await confirmClear(); // presses the red action, then "Clear" in the appAlert
    expect(await screen.findByText(/Codes cleared/)).toBeTruthy();
    expect(useAiDiagnoseStore.getState().trail.map((s) => s.kind)).toEqual(['triage']);
  });

  it('saves the trail, request and end with the run in History (plan 34d)', async () => {
    useMockAi();
    await connectSimulator({ injectedDtcs: ['P0401'] });
    renderWithProviders(<AiDiagnoseScreen />);
    await runDiagnosis();
    const run = useHistoryStore.getState().entries[0] as AiHistoryEntry;
    expect(run.kind).toBe('ai');
    expect(run.trail?.map((s) => s.kind)).toEqual(
      useAiDiagnoseStore.getState().trail.map((s) => s.kind),
    );
    expect(run.trail?.[0].label.key).toBe('aiDiagnose:agent.step.triage');
    expect(run.request).toEqual({ mode: 'everything' });
    expect(run.end).toBe('final');

    // The triage-only re-read after Clear codes keeps its one step, with no request or end.
    await confirmClear();
    await screen.findByText(/Codes cleared/);
    const reread = useHistoryStore.getState().entries[0] as AiHistoryEntry;
    expect(reread.id).not.toBe(run.id);
    expect(reread.trail?.map((s) => s.kind)).toEqual(['triage']);
    expect(reread.request).toBeUndefined();
    expect(reread.end).toBeUndefined();
  });
});

describe('AiReportView citations', () => {
  it('shows the cited steps, the unconfirmed tag and the uncited-findings notice', () => {
    renderWithProviders(
      <AiReportView
        profileId={GOLF}
        ranAt={null}
        report={{
          overall: 'attention',
          summary: 'Agent report',
          source: 'ai',
          disclaimer: 'Disclaimer',
          actions: [],
          uncitedDropped: 2,
          findings: [
            { title: 'Boost low', severity: 'warn', detail: '', steps: [2, 3] },
            {
              title: 'Maybe a sensor',
              severity: 'info',
              detail: '',
              steps: [4],
              unconfirmed: true,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Based on: steps 2, 3')).toBeTruthy();
    expect(screen.getByText('Based on: steps 4')).toBeTruthy();
    expect(screen.getAllByText('Unconfirmed data')).toHaveLength(1);
    expect(
      screen.getByText('2 findings the AI did not back with a step of this run were left out.'),
    ).toBeTruthy();
  });
});
