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
import { useTranslation } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/format';

/** Severity colour tokens (plan 20): AA in both themes. */
const SEVERITY_COLOR: Record<ErrorSeverity, string> = {
  warning: '$statusWarn',
  error: '$statusError',
  fatal: '$statusFatal',
};

type SeverityFilter = 'all' | ErrorSeverity;

function fmtTime(ts: number): string {
  return formatDateTime(ts);
}

function ErrorCard({ e, onRemove }: { e: LoggedError; onRemove: (id: string) => void }) {
  const { t } = useTranslation('errorLog');
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const color = SEVERITY_COLOR[e.severity];
  const monoFont = monoFontFamily(Platform.OS);
  const hasDetail = !!e.stack || !!e.context;

  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor={color} gap="$1">
      <XStack alignItems="center" gap="$2">
        <Text fontWeight="800" fontSize="$1" color={color} textTransform="uppercase">
          {t(`severity.${e.severity}`)}
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
          accessibilityLabel={t('deleteA11y', { source: e.source })}
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
            {open ? t('hideDetails') : t('details')}
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
  const { t } = useTranslation('errorLog');
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
    { value: 'all', label: t('filter.all', { count: errors.length }) },
    { value: 'fatal', label: t('filter.fatal', { count: counts.fatal }) },
    { value: 'error', label: t('filter.error', { count: counts.error }) },
    { value: 'warning', label: t('filter.warning', { count: counts.warning }) },
  ];

  const confirmClear = () =>
    appAlert(t('clearTitle'), t('clearBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('clearAll'), style: 'destructive', onPress: () => clear() },
    ]);

  const onExport = () =>
    appAlert(t('exportTitle'), t('exportBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: 'Markdown', onPress: () => void exportErrors(shown, 'md') },
      { text: 'JSON', onPress: () => void exportErrors(shown, 'json') },
    ]);

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      {/* Plan 32: the one-tap problem report bundles this log with the adapter log and device info. */}
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        alignSelf="flex-start"
        onPress={() => router.push('/feedback')}
        icon={<MessageSquareWarning size={16} color={palette.accent} />}
        accessibilityLabel={t('reportA11y')}
      >
        {t('report')}
      </Button>
      <SegmentedControl
        label={t('filterA11y')}
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
            {t('export')}
          </Button>
          <Button theme="red" onPress={confirmClear} icon={<Trash2 size={16} />}>
            {t('clear')}
          </Button>
        </XStack>
      ) : null}

      {shown.length === 0 ? (
        <YStack alignItems="center" gap="$2" paddingVertical="$6">
          <Bug size={28} color={palette.accent} />
          <Paragraph theme="alt2" textAlign="center">
            {errors.length === 0 ? t('empty') : t('emptyFilter')}
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
