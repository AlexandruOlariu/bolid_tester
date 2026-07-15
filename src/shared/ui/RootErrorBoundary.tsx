/** App-wide React render error boundary (finding F9). `installGlobalErrorHandlers()` already captures
 *  uncaught JS errors and unhandled rejections, but a render error thrown from a component still tears
 *  down the whole React tree with the default crash UX. This class boundary catches those, logs them
 *  to the error store (`source: 'render'`) like every other failure, and renders a minimal themed
 *  fallback with a Retry that resets the boundary so one bad screen can't kill the app.
 *
 *  Mounted in `src/app/_layout.tsx` inside TamaguiProvider/Theme (so the fallback is themed) and
 *  wrapping the navigator — see docs/features/error-log.md. */
import React from 'react';
import { YStack, Text, Paragraph, Button } from 'tamagui';
import { logError } from '@/shared/state/errorLogStore';

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logError({
      source: 'render',
      error,
      severity: 'error',
      // componentStack can be long — clip it so the record stays a compact JSON primitive.
      context: { componentStack: info.componentStack?.slice(0, 2000) ?? '' },
    });
  }

  private reset = (): void => this.setState({ error: null });

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <YStack
        flex={1}
        backgroundColor="$background"
        alignItems="center"
        justifyContent="center"
        padding="$6"
        gap="$4"
      >
        <Text fontSize={22} fontWeight="800" color="$color">
          Something broke
        </Text>
        <Paragraph theme="alt2" textAlign="center">
          A screen hit an unexpected error. Your saved data is safe and the error was logged. Try
          again — if it keeps happening, export the log from More {'>'} Error log.
        </Paragraph>
        <Text fontSize="$2" color="$color" opacity={0.7} textAlign="center">
          {error.message}
        </Text>
        <Button theme="green" onPress={this.reset}>
          Retry
        </Button>
      </YStack>
    );
  }
}
