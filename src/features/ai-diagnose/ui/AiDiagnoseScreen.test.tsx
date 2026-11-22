/** AI Diagnose with the development mock server (`mock://ai`, plan 19): the simulator Golf with
 *  injected codes, an AI-sourced report whose findings carry the Golf fault guides (note + deep-link
 *  buttons), and the bounded follow-up conversation. No network: the dispatcher serves the canned
 *  mock client in this (development) test build. */
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { mockPush, setMockSearchParams } from '@test/mocks/router';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useAiDiagnoseStore } from '../model/aiDiagnoseStore';
import * as diagnoseService from '../api/diagnoseService';
import { AiDiagnoseScreen } from './AiDiagnoseScreen';

const GOLF = 'golf-plus-2009-20tdi';

function useMockAi() {
  useSettingsStore.setState((s) => ({
    ai: { ...s.ai, enabled: true, provider: 'custom', baseUrl: 'mock://ai', model: '' },
  }));
}

async function runDiagnosis() {
  await act(async () => {
    fireEvent.press(screen.getByText('Run diagnosis'));
  });
  return screen.findByText(/Mock AI report/);
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
      fireEvent.press(screen.getByText('Run diagnosis'));
    });
    expect(await screen.findByText('On-device rule-based analysis')).toBeTruthy();
    expect(screen.getByText(/Follow-up questions need an AI provider/)).toBeTruthy();
    expect(screen.queryByLabelText('Follow-up question')).toBeNull();
    expect(screen.queryByText('What should I check first?')).toBeNull();
    // The local finding for the code still cites the Golf guide.
    expect(screen.getByText(/Known check for this car: EGR flow\/position fault/)).toBeTruthy();
  });
});
