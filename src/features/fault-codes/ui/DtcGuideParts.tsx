import React from 'react';
import { router } from 'expo-router';
import { YStack, XStack, Text, Paragraph, Button } from 'tamagui';
import { ValueCard, HIT_SLOP } from '@/shared/ui';
import type { FaultGuide } from '@/shared/vehicles/faultGuides';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import { useTranslation } from '@/shared/i18n';

/** Deep-link buttons of a fault guide (Related data → Extended PIDs, Open routine → Routines).
 *  Shared by the inline Guide in `DtcRow` and the detail sheet. Renders nothing without links. */
export function GuideLinks({ guide, onNavigate }: { guide: FaultGuide; onNavigate?: () => void }) {
  const { t } = useTranslation('faultCodes');
  const dids = guide.relatedDids ?? [];
  if (dids.length === 0 && !guide.routineId) return null;
  return (
    <XStack gap="$2" flexWrap="wrap">
      {dids.length > 0 ? (
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          theme="blue"
          onPress={() => {
            onNavigate?.();
            router.push(`/extended?dids=${encodeURIComponent(dids.join(','))}`);
          }}
        >
          {t('guide.relatedData')}
        </Button>
      ) : null}
      {guide.routineId ? (
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          theme="blue"
          onPress={() => {
            onNavigate?.();
            router.push('/routines');
          }}
        >
          {t('guide.openRoutine')}
        </Button>
      ) : null}
    </XStack>
  );
}

/** The freeze frame captured with this code, or a one-line note when the guide expects one but
 *  none was captured. Renders nothing when the guide does not care about the freeze frame. */
export function CodeFreezeFrame({
  code,
  guide,
  freezeFrames,
}: {
  code: string;
  guide: FaultGuide;
  freezeFrames: FreezeFrame[];
}) {
  const { t } = useTranslation('faultCodes');
  const ff = guide.freezeFrame ? freezeFrames.find((f) => f.triggerDtc === code) : undefined;
  if (ff)
    return (
      <YStack gap="$1">
        <Text fontWeight="700" fontSize="$2">
          {t('freezeFrame.title')}
        </Text>
        <XStack flexWrap="wrap" gap="$2">
          {ff.values.map((v) => (
            <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
          ))}
        </XStack>
      </YStack>
    );
  if (guide.freezeFrame)
    return (
      <Paragraph theme="alt2" fontSize="$2">
        {t('guide.noFreezeFrame')}
      </Paragraph>
    );
  return null;
}
