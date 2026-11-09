import React, { useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import {
  Trash2,
  Download,
  ChevronDown,
  ChevronRight,
  Bug,
  MessageSquareWarning,
} from 'lucide-react-native';
import {
  Screen,
  appAlert,
  monoFontFamily,
  SegmentedControl,
  HIT_SLOP,
  usePalette,
  type SegmentOption,
} from '@/shared/ui';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import type { ErrorSeverity, LoggedError } from '@/shared/lib/errorLog';
import { useErrorLogExport } from '../hooks/useErrorLogExport';

/** Severity colour tokens (plan 20): AA in both themes. */
const SEVERITY_COLOR: Record<ErrorSeverity, string> = {
  warning: '$statusWarn',
  error: '$statusError',
  fatal: '$statusFatal',
};

type SeverityFilter = 'all' | ErrorSeverity;

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function ErrorCard({ e, onRemove }: { e: LoggedError; onRemove: (id: string) => void }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const color = SEVERITY_COLOR[e.severity];
  const monoFont = monoFontFamily(Platform.OS);
  const hasDetail = !!e.stack || !!e.context;

  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor={color} gap="$1">
      <XStack alignItems="center" gap="$2">
        <Text fontWeight="800" fontSize="$1" color={color} textTransform="uppercase">
          {e.severity}
        </Text>
        <Text fontWeight="700" fontSize="$2" flex={1} numberOfLines={1}>
          {e.source}
        </Text>
        <Button
          size="$3"
          circular
          chromeless
          hitSlop={HIT_SLOP}
          icon={<Trash2 size={16} color={palette.muted} />}
          accessibilityLabel={`Delete error: ${e.source}`}
          onPress={() => onRemove(e.id)}
        />
      </XStack>
      <Paragraph theme="alt2" fontSize="$1">
        {fmtTime(e.ts)}
      </Paragraph>
      <Paragraph fontSize="$3">{e.message}</Paragraph>

      {hasDetail ? (
        <Button
          size="$3"
          chromeless
          hitSlop={HIT_SLOP}
          alignSelf="flex-start"
          paddingHorizontal="$0"
          icon={
            open ? (
              <ChevronDown size={14} color={palette.muted} />
            ) : (
              <ChevronRight size={14} color={palette.muted} />
            )
          }
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((v) => !v)}
        >
          <Text fontSize="$1" color="$muted">
            {open ? 'Hide details' : 'Details'}
          </Text>
        </Button>
      ) : null}

      {open && e.context ? (
        <YStack gap="$0.5">
          {Object.entries(e.context).map(([k, v]) => (
            <Text key={k} fontSize="$1" fontFamily={monoFont} color="$color11">
              {k}: {String(v)}
            </Text>
          ))}
        </YStack>
      ) : null}

      {open && e.stack ? (
        <Card backgroundColor="$backgroundStrong" padding="$2" marginTop="$1">
          <Text fontSize="$1" fontFamily={monoFont} color="$color11">
            {e.stack}
          </Text>
        </Card>
      ) : null}
    </Card>
  );
}

export function ErrorLogScreen() {
  const palette = usePalette();
  const router = useRouter();
  const errors = useErrorLogStore((s) => s.errors);
  const remove = useErrorLogStore((s) => s.remove);
  const clear = useErrorLogStore((s) => s.clear);
  const { exportErrors, busy } = useErrorLogExport();
  const [filter, setFilter] = useState<SeverityFilter>('all');

  const counts = useMemo(() => {
    const c = { warning: 0, error: 0, fatal: 0 };
    for (const e of errors) c[e.severity] += 1;
    return c;
  }, [errors]);

  const shown = useMemo(
    () => (filter === 'all' ? errors : errors.filter((e) => e.severity === filter)),
    [errors, filter],
  );

  const filterOptions: SegmentOption<SeverityFilter>[] = [
    { value: 'all', label: `All (${errors.length})` },
    { value: 'fatal', label: `Fatal (${counts.fatal})` },
    { value: 'error', label: `Errors (${counts.error})` },
    { value: 'warning', label: `Warnings (${counts.warning})` },
  ];

  const confirmClear = () =>
    appAlert('Clear error log?', 'This permanently deletes every saved error.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: () => clear() },
    ]);

  const onExport = () =>
    appAlert('Export error log', 'Choose a format to share.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Markdown', onPress: () => void exportErrors(shown, 'md') },
      { text: 'JSON', onPress: () => void exportErrors(shown, 'json') },
    ]);

  return (
    <Screen title="Error log" subtitle="Saved errors to review and export">
      {/* Plan 32: the one-tap problem report bundles this log with the adapter log and device info. */}
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        alignSelf="flex-start"
        onPress={() => router.push('/feedback')}
        icon={<MessageSquareWarning size={16} color={palette.accent} />}
        accessibilityLabel="Report a problem"
      >
        Report
      </Button>
      <SegmentedControl
        label="Show errors by severity"
        options={filterOptions}
        value={filter}
        onChange={setFilter}
      />

      {errors.length > 0 ? (
        <XStack gap="$2" alignItems="center">
          <Button
            flex={1}
            theme="green"
            disabled={busy || shown.length === 0}
            onPress={onExport}
            icon={busy ? () => <Spinner /> : <Download size={16} />}
          >
            Export
          </Button>
          <Button theme="red" onPress={confirmClear} icon={<Trash2 size={16} />}>
            Clear
          </Button>
        </XStack>
      ) : null}

      {shown.length === 0 ? (
        <YStack alignItems="center" gap="$2" paddingVertical="$6">
          <Bug size={28} color={palette.accent} />
          <Paragraph theme="alt2" textAlign="center">
            {errors.length === 0
              ? 'No errors logged. When something goes wrong it’ll be saved here so you can export and fix it later.'
              : 'Nothing for this filter.'}
          </Paragraph>
        </YStack>
      ) : (
        <YStack gap="$2">
          {shown.map((e) => (
            <ErrorCard key={e.id} e={e} onRemove={remove} />
          ))}
        </YStack>
      )}
    </Screen>
  );
}
