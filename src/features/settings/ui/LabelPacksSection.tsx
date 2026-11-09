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

function countsText(pack: LabelPack): string {
  const c = labelPackCounts(pack);
  const parts = [
    c.measurements ? `${c.measurements} measurements` : null,
    c.codingBits ? `${c.codingBits} coding bits` : null,
    c.adaptations ? `${c.adaptations} adaptations` : null,
    c.measuringGroups ? `${c.measuringGroups} measuring groups` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no names';
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
          {countsText(pack)}
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
              accessibilityLabel={`Delete ${pack.module}`}
            >
              Delete
            </Button>
          ) : null}
        </XStack>
      </YStack>
    </Card>
  );
}

/** Settings → Data → **Label packs** (plan 13): import a `bolid.labelpack.v1` file, the imported
 *  packs (Export / Delete) and the bundled ones (Export as template). Imported packs take
 *  precedence over bundled ones for the part numbers both match. */
export function LabelPacksSection() {
  const packs = useLabelPackStore((s) => s.packs);
  const remove = useLabelPackStore((s) => s.remove);
  const importer = useExchangeImport(LABEL_PACKS_SOURCE);
  const [note, setNote] = useState<string | null>(null);

  const share = async (pack: LabelPack) => {
    const uri = await shareLabelPackFile(pack);
    if (!uri && isWebRuntime()) return; // the "not available on web yet" toast already said why
    setNote(
      uri
        ? `Saved ${uri.slice(uri.lastIndexOf('/') + 1)}.`
        : 'Could not export the pack. See More → Error log for details.',
    );
  };
  const confirmDelete = (pack: LabelPack) =>
    appAlert(
      'Delete this label pack?',
      `${pack.module} is removed from this phone. Bundled names for the same part numbers come back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove(pack.id) },
      ],
    );

  return (
    <YStack gap="$2" testID="label-packs-section">
      <Text fontWeight="700" fontSize="$3">
        Label packs
      </Text>
      <Paragraph fontSize="$2">
        Label packs name a module's measurements, coding bits and adaptation channels by part
        number. Import one from a file; imported names take precedence over the bundled ones.
      </Paragraph>
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        disabled={importer.busy}
        onPress={() => void importer.startImport()}
        accessibilityLabel="Import a label pack from a file"
      >
        Import label pack
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
        Imported ({packs.length})
      </Paragraph>
      {packs.length === 0 ? (
        <Paragraph theme="alt2" fontSize="$1">
          No imported label packs yet.
        </Paragraph>
      ) : null}
      {packs.map((p) => (
        <PackRow
          key={p.id}
          pack={p}
          exportLabel="Export"
          onExport={() => void share(p)}
          onDelete={() => confirmDelete(p)}
        />
      ))}
      <Paragraph theme="alt2" fontSize="$2">
        Bundled with the app
      </Paragraph>
      {LABEL_PACKS.map((p) => (
        <PackRow
          key={p.id}
          pack={p}
          exportLabel="Export as template"
          onExport={() => void share(p)}
        />
      ))}
      <ImportPreviewSheet pending={importer.pending} onClose={importer.close} />
    </YStack>
  );
}
