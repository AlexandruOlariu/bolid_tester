import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import {
  YStack,
  XStack,
  Card,
  Text,
  Paragraph,
  Button,
  Spinner,
  Switch,
  TextArea,
  H4,
} from 'tamagui';
import { Braces, ExternalLink, FileText, Mail } from 'lucide-react-native';
import { Screen, HIT_SLOP, usePalette } from '@/shared/ui';
import { APP_VERSION, PRIVACY_POLICY_URL } from '@/shared/lib/appInfo';
import { FEEDBACK_DESCRIPTION_MAX, formatBytes, platformLabel } from '@/shared/lib/feedbackBundle';
import { useAdapterLogStore } from '@/shared/state/adapterLog';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { useErrorLogStore, logError } from '@/shared/state/errorLogStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { vehicleLabel } from '@/shared/vehicles';
import { useFeedbackBundle, type LastScanReport } from '../hooks/useFeedbackBundle';
import { useTranslation } from '@/shared/i18n';

function Item({ children, testID }: { children: string; testID?: string }) {
  return (
    <XStack gap="$2" alignItems="flex-start" testID={testID}>
      <Text
        color="$accent"
        fontWeight="800"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        ✓
      </Text>
      <Paragraph flex={1} fontSize="$3">
        {children}
      </Paragraph>
    </XStack>
  );
}

export interface FeedbackScreenProps {
  /** The last module scan as text, or null (the route reads the module-scan slice). */
  getLastScanReport?: LastScanReport;
  /** Whether a module scan is saved — for the checklist line. */
  hasScan?: boolean;
}

/** **Report a problem** (plan 32): a description, a checklist of what the bundle holds with live
 *  counts, the **Keep VIN and adapter address** switch (off by default) and the four ways to hand
 *  the redacted bundle over. Nothing is sent until the user picks where to share it. */
export function FeedbackScreen({ getLastScanReport, hasScan = false }: FeedbackScreenProps) {
  const { t } = useTranslation('feedback');
  const params = useLocalSearchParams<{ preview?: string }>();
  const preview = params.preview === '1';
  const errorCount = useErrorLogStore((s) => s.errors.length);
  const logLines = useAdapterLogStore((s) => s.entries.length);
  const profile = useActiveProfile();
  const sessionVin = useSessionStore((s) => s.info?.vin ?? null);
  const [description, setDescription] = useState('');
  const [keep, setKeep] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fb = useFeedbackBundle({ getLastScanReport });
  const { build } = fb;
  const isFocused = useIsFocused();
  /** Whether the report was handed over (shared or opened) since the screen was last focused. */
  const handedOver = useRef(false);

  // The screen is a hidden tab and stays mounted: every visit starts with the switch off (it is a
  // per-report choice) and no stale note; a description already handed over is cleared too, while
  // an unsent draft is kept.
  useEffect(() => {
    if (isFocused) return;
    setKeep(false);
    setNote(null);
    if (handedOver.current) {
      setDescription('');
      handedOver.current = false;
    }
  }, [isFocused]);

  // Settings → Developer → Preview feedback bundle: build once on open so the size shows.
  useEffect(() => {
    if (preview) build('', false);
  }, [preview, build]);

  const garageVin = useGarageStore(
    (s) => s.vehicles.find((v) => v.id === profile.id)?.learned?.vin ?? null,
  );
  const vin = sessionVin ?? garageVin;
  const vinText = !vin ? t('vinNotRead') : keep ? `VIN ${vin}` : t('vinHidden');
  const device = platformLabel(Platform.OS, String(Platform.Version ?? ''));

  const afterShare = (saved: string | null) => {
    if (saved) handedOver.current = true;
    setNote(
      saved ? t('note.saved', { file: saved.split('/').pop() ?? saved }) : t('note.saveFailed'),
    );
  };

  const onShareJson = async () => afterShare(await fb.shareJson(description, keep));
  const onShareMarkdown = async () => afterShare(await fb.shareMarkdown(description, keep));
  const onIssue = async () => {
    const ok = await fb.openIssue(description);
    if (ok) handedOver.current = true;
    setNote(ok ? t('note.issue') : t('note.browserFailed'));
  };
  const onEmail = async () => {
    const ok = await fb.email(description, keep);
    if (ok) handedOver.current = true;
    setNote(ok ? t('note.email') : t('note.emailFailed'));
  };
  const openPolicy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch((e: unknown) =>
      logError({ source: 'feedback/privacy-policy', error: e }),
    );
  };

  const disabled = fb.busy;
  const spinner = fb.busy ? () => <Spinner /> : undefined;
  const palette = usePalette();

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <YStack gap="$2">
        <H4>{t('whatHappened')}</H4>
        <TextArea
          value={description}
          onChangeText={(text) => setDescription(text.slice(0, FEEDBACK_DESCRIPTION_MAX))}
          placeholder={t('placeholder')}
          numberOfLines={5}
          minHeight={110}
          maxLength={FEEDBACK_DESCRIPTION_MAX}
          accessibilityLabel={t('placeholder')}
          testID="feedback-description"
        />
        <Paragraph theme="alt2" fontSize="$1" textAlign="right">
          {description.length} / {FEEDBACK_DESCRIPTION_MAX}
        </Paragraph>
      </YStack>

      <Card bordered padding="$3" gap="$2" testID="feedback-contents">
        <Text fontWeight="700">{t('contains')}</Text>
        <Item testID="feedback-errors">{t('errors', { count: errorCount })}</Item>
        <Item testID="feedback-log">{t('logLines', { count: logLines })}</Item>
        <Item testID="feedback-app">{t('app', { version: APP_VERSION, device })}</Item>
        <Item testID="feedback-vehicle">
          {t('vehicle', { car: vehicleLabel(profile), vin: vinText })}
        </Item>
        <Item testID="feedback-scan">{hasScan ? t('scanYes') : t('scanNo')}</Item>
        {fb.sizeBytes !== null ? (
          <Paragraph theme="alt2" fontSize="$2" testID="feedback-size">
            {t('size', { size: formatBytes(fb.sizeBytes) })}
          </Paragraph>
        ) : null}
      </Card>

      <XStack
        alignItems="center"
        justifyContent="space-between"
        backgroundColor="$color2"
        padding="$3"
        borderRadius="$4"
        gap="$3"
      >
        <YStack flex={1}>
          <Text fontWeight="700">{t('keep')}</Text>
          <Paragraph theme="alt2" size="$2">
            {t('keepHelp')}
          </Paragraph>
        </YStack>
        <Switch
          checked={keep}
          onCheckedChange={(v) => setKeep(!!v)}
          hitSlop={HIT_SLOP}
          accessible
          role="switch"
          accessibilityRole="switch"
          accessibilityLabel={t('keep')}
          accessibilityState={{ checked: keep }}
          testID="feedback-keep"
        >
          <Switch.Thumb />
        </Switch>
      </XStack>

      <YStack gap="$2">
        <Button
          theme="green"
          disabled={disabled}
          onPress={onShareJson}
          icon={spinner ?? <Braces size={16} />}
          testID="feedback-share-json"
        >
          {t('shareJson')}
        </Button>
        <Button
          disabled={disabled}
          onPress={onShareMarkdown}
          icon={spinner ?? <FileText size={16} color={palette.muted} />}
          testID="feedback-share-md"
        >
          {t('shareMarkdown')}
        </Button>
        <Button
          disabled={disabled}
          onPress={onIssue}
          icon={spinner ?? <ExternalLink size={16} color={palette.muted} />}
          testID="feedback-issue"
        >
          {t('issue')}
        </Button>
        {fb.emailAvailable ? (
          <Button
            disabled={disabled}
            onPress={onEmail}
            icon={spinner ?? <Mail size={16} color={palette.muted} />}
            testID="feedback-email"
          >
            {t('email')}
          </Button>
        ) : null}
      </YStack>

      {note ? (
        <Paragraph fontSize="$2" testID="feedback-note">
          {note}
        </Paragraph>
      ) : null}

      <YStack gap="$1" paddingTop="$2">
        <Paragraph theme="alt2" fontSize="$2">
          {t('nothingSent')}
        </Paragraph>
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          chromeless
          alignSelf="flex-start"
          paddingHorizontal="$0"
          onPress={openPolicy}
          accessibilityRole="link"
        >
          <Text fontSize="$2" color="$accent" textDecorationLine="underline">
            {t('policy')}
          </Text>
        </Button>
      </YStack>
    </Screen>
  );
}
