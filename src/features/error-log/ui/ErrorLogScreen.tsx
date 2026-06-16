import React, { useMemo, useState } from 'react';
import { Platform, Alert } from 'react-native';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import { Trash2, Download, ChevronDown, ChevronRight, Bug } from 'lucide-react-native';
import { Screen } from '@/shared/ui';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import type { ErrorSeverity, LoggedError } from '@/shared/lib/errorLog';
import { useErrorLogExport } from '../hooks/useErrorLogExport';

const SEVERITY_COLOR: Record<ErrorSeverity, string> = {
  warning: '#d29922',
  error: '#f85149',
  fatal: '#a371f7',
};

type SeverityFilter = 'all' | ErrorSeverity;

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="$2" theme={active ? 'green' : 'gray'} onPress={onPress}>
      {label}
    </Button>
  );
}

function ErrorCard({ e, onRemove }: { e: LoggedError; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const color = SEVERITY_COLOR[e.severity];
  const monoFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });
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
          size="$1"
          circular
          chromeless
          icon={() => <Trash2 size={14} color="#8B949E" />}
          onPress={() => onRemove(e.id)}
        />
      </XStack>
      <Paragraph theme="alt2" fontSize="$1">
        {fmtTime(e.ts)}
      </Paragraph>
      <Paragraph fontSize="$3">{e.message}</Paragraph>

      {hasDetail ? (
        <Button
          size="$1"
          chromeless
          alignSelf="flex-start"
          paddingHorizontal="$0"
          icon={() => (open ? <ChevronDown size={14} color="#8B949E" /> : <ChevronRight size={14} color="#8B949E" />)}
          onPress={() => setOpen((v) => !v)}
        >
          <Text fontSize="$1" color="#8B949E">
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

  const confirmClear = () =>
    Alert.alert('Clear error log?', 'This permanently deletes every saved error.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: () => clear() },
    ]);

  const onExport = () =>
    Alert.alert('Export error log', 'Choose a format to share.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Markdown', onPress: () => void exportErrors(shown, 'md') },
      { text: 'JSON', onPress: () => void exportErrors(shown, 'json') },
    ]);

  return (
    <Screen title="Error log" subtitle="Saved errors to review and export">
      <XStack gap="$2" alignItems="center" flexWrap="wrap">
        <Chip active={filter === 'all'} label={`All (${errors.length})`} onPress={() => setFilter('all')} />
        <Chip active={filter === 'fatal'} label={`Fatal (${counts.fatal})`} onPress={() => setFilter('fatal')} />
        <Chip active={filter === 'error'} label={`Errors (${counts.error})`} onPress={() => setFilter('error')} />
        <Chip active={filter === 'warning'} label={`Warnings (${counts.warning})`} onPress={() => setFilter('warning')} />
      </XStack>

      {errors.length > 0 ? (
        <XStack gap="$2" alignItems="center">
          <Button
            flex={1}
            theme="green"
            disabled={busy || shown.length === 0}
            onPress={onExport}
            icon={busy ? () => <Spinner /> : () => <Download size={16} color="#fff" />}
          >
            Export
          </Button>
          <Button theme="red" onPress={confirmClear} icon={() => <Trash2 size={16} color="#fff" />}>
            Clear
          </Button>
        </XStack>
      ) : null}

      {shown.length === 0 ? (
        <YStack alignItems="center" gap="$2" paddingVertical="$6">
          <Bug size={28} color="#2bb673" />
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
