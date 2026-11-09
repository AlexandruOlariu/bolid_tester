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
import { Screen } from '@/shared/ui';
import { APP_VERSION, PRIVACY_POLICY_URL } from '@/shared/lib/appInfo';
import { FEEDBACK_DESCRIPTION_MAX, formatBytes, platformLabel } from '@/shared/lib/feedbackBundle';
import { useAdapterLogStore } from '@/shared/state/adapterLog';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { useErrorLogStore, logError } from '@/shared/state/errorLogStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { vehicleLabel } from '@/shared/vehicles';
import { useFeedbackBundle, type LastScanReport } from '../hooks/useFeedbackBundle';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Item({ children, testID }: { children: string; testID?: string }) {
  return (
    <XStack gap="$2" alignItems="flex-start" testID={testID}>
      <Text color="#2bb673" fontWeight="800">
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
  const vinText = !vin ? 'VIN not read' : keep ? `VIN ${vin}` : 'VIN hidden';
  const device = platformLabel(Platform.OS, String(Platform.Version ?? ''));

  const afterShare = (saved: string | null) => {
    if (saved) handedOver.current = true;
    setNote(
      saved
        ? `Thanks — bundle saved to the app folder as ${saved.split('/').pop() ?? saved}.`
        : 'The bundle could not be saved. See More → Error log for details.',
    );
  };

  const onShareJson = async () => afterShare(await fb.shareJson(description, keep));
  const onShareMarkdown = async () => afterShare(await fb.shareMarkdown(description, keep));
  const onIssue = async () => {
    const ok = await fb.openIssue(description);
    if (ok) handedOver.current = true;
    setNote(
      ok
        ? 'The issue opens in your browser with the summary filled in (the VIN and adapter address are always removed there). Attach the JSON bundle to it for the full logs.'
        : 'The browser could not be opened. See More → Error log for details.',
    );
  };
  const onEmail = async () => {
    const ok = await fb.email(description, keep);
    if (ok) handedOver.current = true;
    setNote(
      ok
        ? 'Your email app opens with a draft. Attach the JSON bundle from Share bundle.'
        : 'No email app could be opened. Share the bundle instead.',
    );
  };
  const openPolicy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch((e: unknown) =>
      logError({ source: 'feedback/privacy-policy', error: e }),
    );
  };

  const disabled = fb.busy;
  const spinner = fb.busy ? () => <Spinner /> : undefined;

  return (
    <Screen
      title="Report a problem"
      subtitle="Share what happened and the app’s logs — identifiers are removed unless you choose to keep them."
    >
      <YStack gap="$2">
        <H4>What happened?</H4>
        <TextArea
          value={description}
          onChangeText={(t) => setDescription(t.slice(0, FEEDBACK_DESCRIPTION_MAX))}
          placeholder="What were you doing? What did you expect?"
          numberOfLines={5}
          minHeight={110}
          maxLength={FEEDBACK_DESCRIPTION_MAX}
          accessibilityLabel="What were you doing? What did you expect?"
          testID="feedback-description"
        />
        <Paragraph theme="alt2" fontSize="$1" textAlign="right">
          {description.length} / {FEEDBACK_DESCRIPTION_MAX}
        </Paragraph>
      </YStack>

      <Card bordered padding="$3" gap="$2" testID="feedback-contents">
        <Text fontWeight="700">The bundle contains</Text>
        <Item testID="feedback-errors">{`${plural(errorCount, 'error', 'errors')} from the error log`}</Item>
        <Item testID="feedback-log">
          {plural(logLines, 'adapter log line', 'adapter log lines')}
        </Item>
        <Item testID="feedback-app">{`app v${APP_VERSION} · ${device}`}</Item>
        <Item testID="feedback-vehicle">{`vehicle: ${vehicleLabel(profile)} (${vinText})`}</Item>
        <Item testID="feedback-scan">{`last module scan: ${hasScan ? 'yes' : 'no'}`}</Item>
        {fb.sizeBytes !== null ? (
          <Paragraph theme="alt2" fontSize="$2" testID="feedback-size">
            Bundle size: {formatBytes(fb.sizeBytes)}
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
          <Text fontWeight="700">Keep VIN and adapter address</Text>
          <Paragraph theme="alt2" size="$2">
            Only turn this on if the maintainer asked for them.
          </Paragraph>
        </YStack>
        <Switch
          checked={keep}
          onCheckedChange={(v) => setKeep(!!v)}
          accessibilityLabel="Keep VIN and adapter address"
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
          icon={spinner ?? (() => <Braces size={16} color="#fff" />)}
          testID="feedback-share-json"
        >
          Share bundle (JSON)
        </Button>
        <Button
          disabled={disabled}
          onPress={onShareMarkdown}
          icon={spinner ?? (() => <FileText size={16} color="#8B949E" />)}
          testID="feedback-share-md"
        >
          Share summary (Markdown)
        </Button>
        <Button
          disabled={disabled}
          onPress={onIssue}
          icon={spinner ?? (() => <ExternalLink size={16} color="#8B949E" />)}
          testID="feedback-issue"
        >
          Open GitHub issue
        </Button>
        {fb.emailAvailable ? (
          <Button
            disabled={disabled}
            onPress={onEmail}
            icon={spinner ?? (() => <Mail size={16} color="#8B949E" />)}
            testID="feedback-email"
          >
            Email
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
          Nothing is sent until you choose where to share it.
        </Paragraph>
        <Button
          size="$2"
          chromeless
          alignSelf="flex-start"
          paddingHorizontal="$0"
          onPress={openPolicy}
          accessibilityRole="link"
        >
          <Text fontSize="$2" color="#2bb673" textDecorationLine="underline">
            Privacy policy
          </Text>
        </Button>
      </YStack>
    </Screen>
  );
}
