/** Report a problem (plan 32) against the real stores and the simulator: the checklist counts, the
 *  redacted JSON written for the share sheet, the **Keep VIN and adapter address** switch, the
 *  prefilled GitHub issue, and the share buttons disabled while a share runs. */
import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { setMockFocused, setMockSearchParams } from '@test/mocks/router';
import { buildLoggedError } from '@/shared/lib/errorLog';
import { saveTextFile } from '@/shared/lib/saveFile';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { useAdapterLogStore } from '@/shared/state/adapterLog';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { FeedbackScreen } from './FeedbackScreen';

// The `ui` project cannot run saveFile's variable-specifier `import()` (see useErrorLogExport.test):
// stand in for the write + share sheet and keep what was "saved".
jest.mock('@/shared/lib/saveFile', () => ({
  ...jest.requireActual('@/shared/lib/saveFile'),
  saveTextFile: jest.fn(async (name: string) => `file:///test/${name}`),
}));
const save = saveTextFile as jest.MockedFunction<typeof saveTextFile>;

const VIN = 'WVWZZZ1KZ9W903398';
const VIN_HEX = [...VIN].map((c) => c.charCodeAt(0).toString(16).toUpperCase()).join('');
const BUTTON_LABELS: Record<string, string> = {
  'feedback-share-json': 'Share bundle (JSON)',
  'feedback-share-md': 'Share summary (Markdown)',
  'feedback-issue': 'Open GitHub issue',
};

/** The body of the last bundle handed to the share path, checking its name and type. */
function savedFile(ext: 'json' | 'md'): string {
  const call = save.mock.calls.at(-1);
  if (!call) throw new Error(`no .${ext} bundle saved`);
  const [name, body, mime] = call;
  expect(name).toMatch(new RegExp(`^bolid-feedback-.*\\.${ext}$`));
  expect(mime).toBe(ext === 'json' ? 'application/json' : 'text/markdown');
  return body;
}

async function connectGolfWithOneError() {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator();
  useErrorLogStore.setState({
    errors: [
      buildLoggedError({
        source: 'ai-diagnose',
        error: new Error(`AI server at http://192.168.1.20:1234 refused VIN ${VIN}`),
        context: { baseUrl: 'http://192.168.1.20:1234', apiKey: 'sk-abcdEFGH1234' },
      }),
    ],
  });
}

describe('FeedbackScreen', () => {
  it('shows live counts and writes a redacted JSON bundle', async () => {
    await connectGolfWithOneError();
    renderWithProviders(<FeedbackScreen getLastScanReport={() => null} />);

    expect(screen.getByTestId('feedback-errors')).toHaveTextContent(
      /^✓1 error from the error log$/,
    );
    const lines = useAdapterLogStore.getState().entries.length;
    expect(lines).toBeGreaterThan(0);
    expect(screen.getByTestId('feedback-log')).toHaveTextContent(
      new RegExp(`${lines} adapter log lines$`),
    );
    expect(screen.getByTestId('feedback-vehicle')).toHaveTextContent(
      /vehicle: VW Golf Plus 2009 .*\(VIN hidden\)/,
    );
    expect(screen.getByTestId('feedback-scan')).toHaveTextContent(/last module scan: no$/);
    expect(screen.queryByTestId('feedback-email')).toBeNull(); // no feedback address configured

    fireEvent.changeText(screen.getByTestId('feedback-description'), 'Live data froze.');
    fireEvent.press(screen.getByTestId('feedback-share-json'));
    await waitFor(() => expect(screen.getByTestId('feedback-note')).toHaveTextContent(/Thanks/));

    const json = savedFile('json');
    const bundle = JSON.parse(json);
    expect(bundle.redacted).toBe(true);
    expect(bundle.description).toBe('Live data froze.');
    expect(bundle.vehicle.vin).toBe('***03398');
    expect(json).toContain('***03398');
    expect(json).not.toContain(VIN);
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toContain('sk-abcd');
    expect(bundle.adapterLog.length).toBe(lines);
    // The simulator answered the VIN request; its ASCII-hex reply is masked to the last five bytes.
    const live = useAdapterLogStore
      .getState()
      .entries.map((e) => e.text)
      .join('');
    // Multi-frame: 0:490201575657 / 1:5A5A5A314B5A39 / 2:57393033333938 ("WVW" "ZZZ1KZ9" "W903398").
    expect(live).toContain(`0:490201${VIN_HEX.slice(0, 6)}`);
    expect(json).not.toContain(VIN_HEX.slice(0, 6));
    expect(json).not.toContain(VIN_HEX.slice(6, 20));
    expect(json).toContain(`****${VIN_HEX.slice(24)}`);
    expect(screen.getByTestId('feedback-note')).toHaveTextContent(/bolid-feedback-.*\.json/);
    expect(screen.getByTestId('feedback-size')).toHaveTextContent(/Bundle size: .*KB/);
  });

  it('keeps the VIN when the switch is on', async () => {
    await connectGolfWithOneError();
    renderWithProviders(<FeedbackScreen />);

    fireEvent(screen.getByTestId('feedback-keep'), 'onCheckedChange', true);
    expect(screen.getByTestId('feedback-vehicle')).toHaveTextContent(
      new RegExp(`\\(VIN ${VIN}\\)$`),
    );
    fireEvent.press(screen.getByTestId('feedback-share-json'));
    await waitFor(() => expect(screen.getByTestId('feedback-note')).toHaveTextContent(/Thanks/));

    const bundle = JSON.parse(savedFile('json'));
    expect(bundle.redacted).toBe(false);
    expect(bundle.vehicle.vin).toBe(VIN);
    // Only the VIN and the adapter address are kept: no AI server address or key, ever.
    const json = savedFile('json');
    expect(json).not.toContain('sk-abcd');
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toContain('apiKey');
  });

  it('turns the switch off again when the (still mounted) screen loses focus', async () => {
    await connectGolfWithOneError();
    renderWithProviders(<FeedbackScreen />);
    const vehicle = () => screen.getByTestId('feedback-vehicle');
    const draft = () =>
      (screen.getByTestId('feedback-description').props as { value: string }).value;
    // Re-render the mounted screen, as navigating away and back does (the mock reads the focus):
    // one more logged error changes the checklist count.
    let n = 0;
    const bump = () =>
      act(() =>
        useErrorLogStore.setState((s) => ({
          errors: [
            buildLoggedError({ source: 'test', error: new Error('x') }, { id: `b${n++}`, ts: n }),
            ...s.errors,
          ],
        })),
      );

    fireEvent(screen.getByTestId('feedback-keep'), 'onCheckedChange', true);
    fireEvent.changeText(screen.getByTestId('feedback-description'), 'Unsent draft');
    expect(vehicle()).toHaveTextContent(new RegExp(`\\(VIN ${VIN}\\)$`));
    setMockFocused(false);
    await bump();
    setMockFocused(true);
    await bump();
    expect(vehicle()).toHaveTextContent(/\(VIN hidden\)$/);
    expect(draft()).toBe('Unsent draft'); // an unsent draft survives

    fireEvent(screen.getByTestId('feedback-keep'), 'onCheckedChange', true);
    fireEvent.press(screen.getByTestId('feedback-share-json'));
    await waitFor(() => expect(screen.getByTestId('feedback-note')).toHaveTextContent(/Thanks/));
    setMockFocused(false);
    await bump();
    setMockFocused(true);
    await bump();
    expect(vehicle()).toHaveTextContent(/\(VIN hidden\)$/);
    expect(screen.queryByTestId('feedback-note')).toBeNull();
    expect(draft()).toBe(''); // a report already handed over starts afresh
  });

  it('includes the last module scan when the route hands one in', async () => {
    renderWithProviders(
      <FeedbackScreen hasScan getLastScanReport={() => `Auto-Scan\nVIN: ${VIN}\n`} />,
    );
    expect(screen.getByTestId('feedback-scan')).toHaveTextContent(/last module scan: yes$/);
    fireEvent.press(screen.getByTestId('feedback-share-md'));
    await waitFor(() => expect(screen.getByTestId('feedback-note')).toHaveTextContent(/Thanks/));
    const md = savedFile('md');
    expect(md).toContain('<details><summary>Last module scan</summary>');
    expect(md).toContain('VIN: ***03398');
    expect(md).not.toContain(VIN);
  });

  it('opens a prefilled GitHub issue, redacted even when identifiers are kept', async () => {
    await connectGolfWithOneError();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderWithProviders(<FeedbackScreen />);

    fireEvent(screen.getByTestId('feedback-keep'), 'onCheckedChange', true);
    fireEvent.changeText(screen.getByTestId('feedback-description'), 'Charts stop updating');
    fireEvent.press(screen.getByTestId('feedback-issue'));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));

    const url = open.mock.calls[0][0];
    expect(url.startsWith('https://github.com/AlexandruOlariu/bolid_tester/issues/new?')).toBe(
      true,
    );
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('title')).toBe('Problem report: Charts stop updating');
    expect(params.get('body')).toContain('| VIN | ***03398 |');
    expect(url).not.toContain(VIN);
    open.mockRestore();
  });

  it('disables the share buttons while a share is running', async () => {
    let release: () => void = () => undefined;
    save.mockImplementationOnce(
      (name: string) =>
        new Promise<string | null>((resolve) => {
          release = () => resolve(`file:///test/${name}`);
        }),
    );
    renderWithProviders(<FeedbackScreen />);
    // True when the button (or the pressable it renders into) is disabled.
    const disabled = (id: string) => {
      type Node = ReturnType<typeof screen.getByTestId>;
      let n: Node | null = screen.getByText(BUTTON_LABELS[id]);
      while (n) {
        const props = n.props as {
          disabled?: boolean;
          accessibilityState?: { disabled?: boolean };
        };
        if (props.disabled || props.accessibilityState?.disabled) return true;
        n = n.parent;
      }
      return false;
    };

    expect(disabled('feedback-share-json')).toBe(false);
    fireEvent.press(screen.getByTestId('feedback-share-json'));
    await waitFor(() => expect(disabled('feedback-share-json')).toBe(true));
    expect(disabled('feedback-share-md')).toBe(true);
    expect(disabled('feedback-issue')).toBe(true);

    await act(async () => release());
    await waitFor(() => expect(disabled('feedback-share-json')).toBe(false));
  });

  it('logs a feedback/share entry when no file could be written, so the note points somewhere', async () => {
    useErrorLogStore.setState({ errors: [] });
    save.mockResolvedValueOnce(null); // no document directory: null without a throw
    renderWithProviders(<FeedbackScreen />);
    fireEvent.press(screen.getByTestId('feedback-share-json'));
    await waitFor(() =>
      expect(screen.getByTestId('feedback-note')).toHaveTextContent(/could not be saved/),
    );
    expect(useErrorLogStore.getState().errors.map((e) => e.source)).toContain('feedback/share');
  });

  it('builds the bundle on open in preview mode, so its size shows', async () => {
    setMockSearchParams({ preview: '1' });
    renderWithProviders(<FeedbackScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('feedback-size')).toHaveTextContent(/Bundle size/),
    );
  });
});
