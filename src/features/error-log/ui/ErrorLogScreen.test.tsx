/** The Error log's Export button in the browser (plan 28 acceptance "error-log export downloads a
 *  .md file"), through the real button path: Export → the in-app format chooser (react-native-web's
 *  `Alert.alert` is a no-op) → Markdown → a download. */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { buildLoggedError } from '@/shared/lib/errorLog';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { clearDialogs } from '@/shared/state/dialogStore';
import { AlertDialog } from '@/shared/ui';
import { ErrorLogScreen } from './ErrorLogScreen';

describe('ErrorLogScreen in the browser', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, URL: g.URL, Blob: g.Blob };
  const clicked: { href: string; download: string }[] = [];
  const blobs: { parts: string[]; type: string }[] = [];

  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    clicked.length = 0;
    blobs.length = 0;
    g.document = {
      createElement: () => {
        const a = { href: '', download: '', rel: '', style: {}, click: () => clicked.push(a) };
        return a;
      },
      body: { appendChild: () => undefined, removeChild: () => undefined },
    };
    g.URL = { createObjectURL: () => 'blob:errors', revokeObjectURL: jest.fn() };
    g.Blob = class {
      constructor(parts: string[], opts: { type: string }) {
        blobs.push({ parts, type: opts.type });
      }
    };
    useErrorLogStore.setState({
      errors: [buildLoggedError({ source: 'connection', error: new Error('ATZ timed out') })],
    });
  });
  afterEach(() => {
    act(() => clearDialogs());
    useErrorLogStore.setState({ errors: [] });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  });

  function renderScreen() {
    renderWithProviders(
      <>
        <ErrorLogScreen />
        <AlertDialog />
      </>,
    );
  }

  it('Export → Markdown downloads a .md file', async () => {
    renderScreen();
    fireEvent.press(screen.getByText('Export'));
    expect(screen.getByTestId('alert-dialog')).toHaveTextContent(/Choose a format/);
    fireEvent.press(screen.getByText('Markdown'));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].download).toMatch(/^bolid-errors-.*\.md$/);
    expect(blobs[0].type).toBe('text/markdown');
    expect(blobs[0].parts.join('')).toContain('ATZ timed out');
  });

  it('Clear asks first and only clears on "Clear all"', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Clear'));
    fireEvent.press(screen.getByText('Cancel'));
    expect(useErrorLogStore.getState().errors).toHaveLength(1);
    fireEvent.press(screen.getByText('Clear'));
    fireEvent.press(screen.getByText('Clear all'));
    expect(useErrorLogStore.getState().errors).toHaveLength(0);
  });

  it('Report opens Report a problem (plan 32)', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Report'));
    expect(mockPush).toHaveBeenCalledWith('/feedback');
  });
});
