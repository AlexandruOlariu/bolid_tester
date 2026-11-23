/** "Send to Claude / ChatGPT" (plan 34d): a sheet previewing the run's share package
 *  (`buildAgentSharePackage`) as selectable text, an **Include VIN** switch (off each time the sheet
 *  opens; the preview follows it) and **Share**, which hands the text to the system share sheet so
 *  the owner can paste it into Claude, ChatGPT or any other app. No network destination of its own.
 *  A share sheet that fails to open is logged as an `ai-diagnose` warning; dismissing it is fine.
 *  See docs/features/ai-diagnose.md → Send to Claude / ChatGPT. */
import React, { useMemo, useState } from 'react';
import { Share } from 'react-native';
import { Sheet, YStack, Text, Paragraph, Button } from 'tamagui';
import { Share2 } from 'lucide-react-native';
import { LabeledSwitch, SectionTitle } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';
import { buildAgentSharePackage, type AgentShareInput } from '@/shared/lib/agentShare';
import { logError } from '@/shared/state/errorLogStore';

function SharePackageBody({ input }: { input: AgentShareInput }) {
  const { t } = useTranslation('aiDiagnose');
  const [includeVin, setIncludeVin] = useState(false);
  const message = useMemo(() => buildAgentSharePackage(input, { includeVin }), [input, includeVin]);
  const share = async () => {
    try {
      await Share.share({ message, title: t('share.title') });
    } catch (error) {
      logError({ source: 'ai-diagnose', error, severity: 'warning', context: { phase: 'share' } });
    }
  };
  return (
    <YStack gap="$3" paddingBottom="$6">
      <Text fontWeight="800" fontSize="$6" accessibilityRole="header">
        {t('share.title')}
      </Text>
      <YStack gap="$1">
        <LabeledSwitch
          label={t('share.includeVin')}
          checked={includeVin}
          onCheckedChange={setIncludeVin}
        />
        <Paragraph theme="alt2" fontSize="$2">
          {t('share.includeVinHint')}
        </Paragraph>
      </YStack>
      <Button theme="blue" onPress={() => void share()} icon={<Share2 size={18} />}>
        {t('share.send')}
      </Button>
      <SectionTitle>{t('share.preview')}</SectionTitle>
      <YStack backgroundColor="$color2" padding="$3" borderRadius="$3">
        <Text fontSize="$2" fontFamily="$mono" selectable>
          {message}
        </Text>
      </YStack>
    </YStack>
  );
}

/** Open while `input` is set; `onClose` when the owner dismisses it. */
export function SharePackageSheet({
  input,
  onClose,
}: {
  input: AgentShareInput | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      modal
      open={input !== null}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      snapPoints={[85]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame padding="$4">
        <Sheet.ScrollView>{input ? <SharePackageBody input={input} /> : null}</Sheet.ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}
