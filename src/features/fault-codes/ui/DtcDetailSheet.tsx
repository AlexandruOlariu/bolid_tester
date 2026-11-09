import React from 'react';
import { Linking, Share } from 'react-native';
import { router } from 'expo-router';
import { Sheet, YStack, XStack, Text, Paragraph, Button } from 'tamagui';
import { Sparkles, Search, Share2 } from 'lucide-react-native';
import { curatedProfileId, type VehicleProfile } from '@/shared/vehicles';
import { matchFaultGuide } from '@/shared/vehicles/faultGuides';
import { vagCodeForDtc, type Dtc } from '@/shared/obd-core/obd/dtc';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import { logError } from '@/shared/state/errorLogStore';
import {
  DTC_DETAIL_FOOTER,
  SEVERITY_META,
  buildDtcDetail,
  dtcShareMessage,
  dtcWebSearchUrl,
} from '../model/dtcDetail';
import { CodeFreezeFrame, GuideLinks } from './DtcGuideParts';

/** Full detail for one fault code (plan 05), opened by tapping the code in a DTC row: meaning,
 *  severity, system, freeze frame, the fault guide, and the Explain with AI / web search / share
 *  actions. See docs/features/fault-codes.md § "Detail sheet". */
export function DtcDetailSheet({
  dtc,
  profile,
  freezeFrames,
  onClose,
}: {
  /** The code to show; null keeps the sheet closed. */
  dtc: Dtc | null;
  /** The active car (registry or garage profile). */
  profile: VehicleProfile;
  freezeFrames: FreezeFrame[];
  onClose: () => void;
}) {
  return (
    <Sheet
      modal
      open={dtc !== null}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      snapPoints={[85]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame padding="$4">
        <Sheet.ScrollView>
          {dtc ? (
            <DtcDetailBody
              dtc={dtc}
              profile={profile}
              freezeFrames={freezeFrames}
              onClose={onClose}
            />
          ) : null}
        </Sheet.ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}

function DtcDetailBody({
  dtc,
  profile,
  freezeFrames,
  onClose,
}: {
  dtc: Dtc;
  profile: VehicleProfile;
  freezeFrames: FreezeFrame[];
  onClose: () => void;
}) {
  const vehicleName = profile.id === 'generic' ? undefined : profile.name;
  const detail = buildDtcDetail(dtc.code, dtc.description, profile.make);
  const { info } = detail;
  const sev = SEVERITY_META[info.severity];
  const guide = matchFaultGuide(
    curatedProfileId(profile),
    info.code,
    vagCodeForDtc(info.code) || undefined,
  );

  const explainWithAi = () => {
    onClose();
    router.push({ pathname: '/ai-diagnose', params: { focus: info.code } });
  };
  const searchWeb = () => {
    Linking.openURL(dtcWebSearchUrl(info.code, vehicleName)).catch((e: unknown) =>
      logError({ source: 'fault-codes/web-search', error: e, severity: 'warning' }),
    );
  };
  const share = () => {
    Share.share({ message: dtcShareMessage(detail, vehicleName) }).catch((e: unknown) =>
      logError({ source: 'fault-codes/share-code', error: e, severity: 'warning' }),
    );
  };

  return (
    <YStack gap="$3" paddingBottom="$6">
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <YStack>
          <Text fontWeight="900" fontSize="$9" color="$statusError">
            {info.code}
          </Text>
          {detail.vagCode ? (
            <Paragraph theme="alt2" fontSize="$2">
              VAG {detail.vagCode}
            </Paragraph>
          ) : null}
        </YStack>
        <Text
          fontWeight="800"
          fontSize="$2"
          color="$onFill"
          backgroundColor={sev.color}
          paddingHorizontal="$3"
          paddingVertical="$1.5"
          borderRadius="$10"
          accessibilityLabel={`Severity: ${sev.label}`}
        >
          {sev.label}
        </Text>
      </XStack>

      <YStack gap="$1">
        <Text fontWeight="700" fontSize="$5">
          {detail.description}
        </Text>
        <Paragraph theme="alt2" fontSize="$2">
          {detail.systemLine}
        </Paragraph>
        <Paragraph theme="alt2" fontSize="$2">
          {sev.hint}
        </Paragraph>
        {info.manufacturerSpecific ? (
          <Text
            alignSelf="flex-start"
            fontSize="$1"
            fontWeight="800"
            color="$statusWarn"
            borderColor="$statusWarn"
            borderWidth={1}
            borderRadius="$10"
            paddingHorizontal="$2"
            paddingVertical="$1"
          >
            Manufacturer-specific
          </Text>
        ) : null}
      </YStack>

      <CodeFreezeFrame code={info.code} guide={guide} freezeFrames={freezeFrames} />

      <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$3">
        <Text fontWeight="700">Guide</Text>
        <Paragraph fontSize="$2">{guide.note}</Paragraph>
        <GuideLinks guide={guide} onNavigate={onClose} />
      </YStack>

      <XStack gap="$2" flexWrap="wrap">
        <Button theme="green" onPress={explainWithAi} icon={<Sparkles size={16} />}>
          Explain with AI
        </Button>
        <Button onPress={searchWeb} icon={() => <Search size={16} />}>
          Search the web
        </Button>
        <Button onPress={share} icon={() => <Share2 size={16} />}>
          Share
        </Button>
      </XStack>

      <Paragraph theme="alt2" fontSize="$1">
        {DTC_DETAIL_FOOTER}
      </Paragraph>
    </YStack>
  );
}
