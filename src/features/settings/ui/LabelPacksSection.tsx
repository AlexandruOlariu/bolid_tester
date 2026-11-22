import React, { useState } from 'react';
import { YStack, XStack, Text, Paragraph, Button, Card } from 'tamagui';
import { LABEL_PACKS, type LabelPack } from '@/shared/labels';
import { labelPackCounts } from '@/shared/lib/exchange';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { ImportPreviewSheet } from '@/shared/ui/ImportPreviewSheet';
import { useExchangeImport } from '@/shared/ui/useExchangeImport';
import { LABEL_PACKS_SOURCE, shareLabelPackFile } from '../api/labelPackFile';
import { appAlert, HIT_SLOP } from '@/shared/ui';
import { isWebRuntime } from '@/shared/lib/webRuntime';
import { useTranslation, type TFunction } from '@/shared/i18n';

function countsText(pack: LabelPack, t: TFunction): string {
  const c = labelPackCounts(pack);
  const parts = [
    c.measurements ? t('packs.measurements', { count: c.measurements }) : null,
    c.codingBits ? t('packs.codingBits', { count: c.codingBits }) : null,
    c.adaptations ? t('packs.adaptations', { count: c.adaptations }) : null,
    c.measuringGroups ? t('packs.measuringGroups', { count: c.measuringGroups }) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('packs.noNames');
}

function PackRow({
  pack,
  onExport,
  onDelete,
  exportLabel,
}: {
  pack: LabelPack;
  onExport: () => void;
  onDelete?: () => void;
  exportLabel: string;
}) {
  const { t } = useTranslation('settings');
  return (
    <Card bordered padding="$3" backgroundColor="$background">
      <YStack gap="$1">
        <Text fontWeight="700" fontSize="$3">
          {pack.module}
        </Text>
        <Paragraph theme="alt2" fontSize="$1" fontFamily="monospace">
          {pack.partNumberPrefixes.map((p) => `${p}…`).join(', ')}
        </Paragraph>
        <Paragraph theme="alt2" fontSize="$1">
          {countsText(pack, t)}
        </Paragraph>
        <XStack gap="$2" marginTop="$1">
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            onPress={onExport}
            accessibilityLabel={`${exportLabel}: ${pack.module}`}
          >
            {exportLabel}
          </Button>
          {onDelete ? (
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              theme="red"
              onPress={onDelete}
              accessibilityLabel={t('packs.deleteA11y', { module: pack.module })}
            >
              {t('packs.delete')}
            </Button>
          ) : null}
        </XStack>
      </YStack>
    </Card>
  );
}

/** Settings → **Label packs** (plan 13, its own page): import a `bolid.labelpack.v1` file, the imported
 *  packs (Export / Delete) and the bundled ones (Export as template). Imported packs take
 *  precedence over bundled ones for the part numbers both match. */
export function LabelPacksSection() {
  const { t } = useTranslation('settings');
  const packs = useLabelPackStore((s) => s.packs);
  const remove = useLabelPackStore((s) => s.remove);
  const importer = useExchangeImport(LABEL_PACKS_SOURCE);
  const [note, setNote] = useState<string | null>(null);

  const share = async (pack: LabelPack) => {
    const uri = await shareLabelPackFile(pack);
    if (!uri && isWebRuntime()) return; // the "not available on web yet" toast already said why
    setNote(
      uri
        ? t('packs.saved', { file: uri.slice(uri.lastIndexOf('/') + 1) })
        : t('packs.exportFailed'),
    );
  };
  const confirmDelete = (pack: LabelPack) =>
    appAlert(t('packs.deleteTitle'), t('packs.deleteBody', { module: pack.module }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('packs.delete'), style: 'destructive', onPress: () => remove(pack.id) },
    ]);

  return (
    <YStack gap="$2" testID="label-packs-section">
      <Paragraph fontSize="$2">{t('packs.help')}</Paragraph>
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        disabled={importer.busy}
        onPress={() => void importer.startImport()}
        accessibilityLabel={t('packs.importA11y')}
      >
        {t('packs.import')}
      </Button>
      {importer.note ? (
        <Paragraph theme="alt2" fontSize="$1">
          {importer.note}
        </Paragraph>
      ) : null}
      {note ? (
        <Paragraph theme="alt2" fontSize="$1" testID="label-pack-note">
          {note}
        </Paragraph>
      ) : null}
      <Paragraph theme="alt2" fontSize="$2">
        {t('packs.imported', { count: packs.length })}
      </Paragraph>
      {packs.length === 0 ? (
        <Paragraph theme="alt2" fontSize="$1">
          {t('packs.none')}
        </Paragraph>
      ) : null}
      {packs.map((p) => (
        <PackRow
          key={p.id}
          pack={p}
          exportLabel={t('packs.export')}
          onExport={() => void share(p)}
          onDelete={() => confirmDelete(p)}
        />
      ))}
      <Paragraph theme="alt2" fontSize="$2">
        {t('packs.bundled')}
      </Paragraph>
      {LABEL_PACKS.map((p) => (
        <PackRow
          key={p.id}
          pack={p}
          exportLabel={t('packs.exportTemplate')}
          onExport={() => void share(p)}
        />
      ))}
      <ImportPreviewSheet pending={importer.pending} onClose={importer.close} />
    </YStack>
  );
}
