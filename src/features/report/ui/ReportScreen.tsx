import React, { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import { SquareCheck, Square, FileText, FileCode, FileType } from 'lucide-react-native';
import { Screen, appAlert, usePalette, HIT_SLOP, type Tone } from '@/shared/ui';
import {
  REPORT_SECTIONS,
  REPORT_SECTION_TITLES,
  reportHeadline,
  reportSeverity,
  type ReportSectionId,
  type ReportSeverity,
  type VehicleReportModel,
} from '@/shared/lib/vehicleReport';
import { useVehicleReport } from '../hooks/useVehicleReport';
import { useReportExport } from '../hooks/useReportExport';
import { isWebRuntime } from '@/shared/lib/webRuntime';
import { useTranslation } from '@/shared/i18n';

/** Where each section's data comes from — the "Run now" link of a section that has none yet. */
const RUN_ROUTE: Record<ReportSectionId, string> = {
  faults: '/faults',
  scan: '/module-scan',
  inspection: '/inspection',
  battery: '/battery',
  ai: '/ai-diagnose',
  maintenance: '/maintenance',
};

/** On-screen severity colours (plan 20): a semantic tone per severity, resolved for the current
 *  theme. `SEVERITY_COLOR` in `vehicleReport.ts` is the HTML export's fixed palette, not for UI. */
const SEVERITY_TONE: Record<ReportSeverity, Tone> = {
  ok: 'statusOk',
  attention: 'statusWarn',
  urgent: 'statusError',
};

function SectionRow({
  id,
  available,
  checked,
  onToggle,
  onRun,
}: {
  id: ReportSectionId;
  available: boolean;
  checked: boolean;
  onToggle: () => void;
  onRun: () => void;
}) {
  const { t } = useTranslation('report');
  const title = t(`section.${id}.title`, { defaultValue: REPORT_SECTION_TITLES[id] });
  const Icon = checked ? SquareCheck : Square;
  const palette = usePalette();
  return (
    <XStack alignItems="center" gap="$3" paddingVertical="$2">
      <XStack
        flex={1}
        alignItems="center"
        gap="$3"
        opacity={available ? 1 : 0.5}
        onPress={available ? onToggle : undefined}
        accessible
        accessibilityRole="checkbox"
        accessibilityLabel={title}
        accessibilityState={{ checked, disabled: !available }}
      >
        <Icon size={20} color={available ? palette.accent : palette.muted} />
        <YStack flex={1}>
          <Text fontWeight="700">{title}</Text>
          <Paragraph theme="alt2" fontSize="$2">
            {available ? t(`section.${id}.hint`) : t('notRun')}
          </Paragraph>
        </YStack>
      </XStack>
      {available ? null : (
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          chromeless
          onPress={onRun}
          accessibilityLabel={t('runNowA11y', { title })}
        >
          {t('runNow')}
        </Button>
      )}
    </XStack>
  );
}

function Preview({ model }: { model: VehicleReportModel }) {
  const { t } = useTranslation('report');
  const sev = reportSeverity(model);
  const color = usePalette()[SEVERITY_TONE[sev]];
  return (
    <Card bordered padding="$3" gap="$1" borderLeftWidth={3} borderLeftColor={color}>
      <XStack alignItems="center" gap="$2">
        <Text fontWeight="800" flex={1}>
          {model.identity.label}
        </Text>
        <Text fontWeight="800" fontSize="$2" color={color}>
          {t(`severity.${sev}`)}
        </Text>
      </XStack>
      <Paragraph theme="alt2" fontSize="$2">
        VIN {model.identity.vin ?? t('notAvailable')}
      </Paragraph>
      <Paragraph theme="alt2" fontSize="$2">
        {model.identity.connected ? t('connected') : t('notConnected')}
      </Paragraph>
      <Paragraph fontSize="$3">{reportHeadline(model)}</Paragraph>
    </Card>
  );
}

/** **Vehicle report** (plan 15): pick the sections, preview the headline, share the whole car as
 *  one PDF, HTML or Markdown document. Works offline from stored data. See docs/features/report.md. */
export function ReportScreen() {
  const { t } = useTranslation('report');
  const router = useRouter();
  const palette = usePalette();
  const { available, build } = useVehicleReport();
  const { sharePdf, shareHtml, shareMarkdown, busy } = useReportExport();
  const [unchecked, setUnchecked] = useState<ReadonlySet<ReportSectionId>>(new Set());
  const [lastFile, setLastFile] = useState<string | null>(null);

  // Checked sections go in; never-run ones are requested too, so the document lists them under
  // "Not run yet" instead of silently leaving them out.
  const include = useMemo(
    () => REPORT_SECTIONS.filter((id) => !available[id] || !unchecked.has(id)),
    [available, unchecked],
  );
  const preview = useMemo(() => build(include), [build, include]);

  const toggle = (id: ReportSectionId) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // In the browser the export layer already said "not available on web yet" (a toast, plan 28);
  // a second, native-worded "could not be saved" dialog would contradict it.
  const done = (uri: string | null) => {
    if (uri) setLastFile(uri.slice(uri.lastIndexOf('/') + 1));
    else if (!isWebRuntime()) appAlert(t('shareUnavailable'), t('notSaved'));
  };

  const onPdf = async () => {
    const model = build(include);
    const uri = await sharePdf(model);
    if (uri) return done(uri);
    if (isWebRuntime()) return; // toast shown once; the HTML fallback would only repeat it
    // No PDF printer in this build (or it failed): share the same document as HTML instead.
    const html = await shareHtml(model);
    if (html) appAlert(t('pdfUnavailable'), t('sharedHtml'));
    done(html);
  };
  const onHtml = async () => done(await shareHtml(build(include)));
  const onMarkdown = async () => done(await shareMarkdown(build(include)));

  const spinner = () => <Spinner />;

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <Preview model={preview} />

      <Card bordered padding="$3">
        <Text fontWeight="800">{t('sections')}</Text>
        {REPORT_SECTIONS.map((id) => (
          <SectionRow
            key={id}
            id={id}
            available={available[id]}
            checked={available[id] && !unchecked.has(id)}
            onToggle={() => toggle(id)}
            onRun={() => router.push(RUN_ROUTE[id])}
          />
        ))}
      </Card>

      <YStack gap="$2">
        <Button
          theme="green"
          onPress={onPdf}
          disabled={busy}
          icon={busy ? spinner : <FileText size={18} />}
        >
          {t('sharePdf')}
        </Button>
        <XStack gap="$2">
          <Button
            flex={1}
            onPress={onHtml}
            disabled={busy}
            icon={busy ? spinner : <FileCode size={18} color={palette.accent} />}
          >
            {t('shareHtml')}
          </Button>
          <Button
            flex={1}
            onPress={onMarkdown}
            disabled={busy}
            icon={busy ? spinner : <FileType size={18} color={palette.accent} />}
          >
            {t('shareMarkdown')}
          </Button>
        </XStack>
      </YStack>
      {lastFile ? (
        <Paragraph theme="alt2" fontSize="$2">
          {t('saved', { file: lastFile })}
        </Paragraph>
      ) : null}
    </Screen>
  );
}
