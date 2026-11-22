import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Card, YStack, XStack, Text, Paragraph, Button, H4 } from 'tamagui';
import { CheckCircle2 } from 'lucide-react-native';
import { CardGrid, Screen, appAlert, HIT_SLOP, usePalette, useReducedMotion } from '@/shared/ui';
import { ImportPreviewSheet } from '@/shared/ui/ImportPreviewSheet';
import { useExchangeImport } from '@/shared/ui/useExchangeImport';
import {
  VEHICLE_PROFILES,
  getVehicleProfile,
  pickVehicleForVin,
  suggestProfilesForVin,
  vinSuffix,
  type UserVehicle,
  type VehicleProfile,
} from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { PROTOCOL_LABELS } from '@/shared/obd-core/obd/protocols';
import { useVehicleStore } from '../model/vehicleStore';
import { deleteGarageVehicle, learnFromConnectedCar } from '../api/learnVehicle';
import { EXCHANGE_SOURCE, shareProfileSeedFile, shareVehicleFile } from '../api/exchange';
import { isWebRuntime } from '@/shared/lib/webRuntime';
import { VehicleEditorSheet } from './VehicleEditorSheet';
import { Trans, useTranslation, type TFunction } from '@/shared/i18n';

/** The garage explainer (an i18n key, plan 11). */
export const GARAGE_COPY = 'vehicleSelect:garage.copy';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <XStack
      backgroundColor="$backgroundPress"
      paddingHorizontal="$2"
      paddingVertical="$1"
      borderRadius="$2"
      alignSelf="flex-start"
    >
      <Text fontSize="$1" color="$placeholderColor" fontFamily="monospace">
        {children}
      </Text>
    </XStack>
  );
}

/** The buttons inside a garage card, also offered as the card's screen-reader actions (plan 20). */
const garageCardActions = (t: TFunction) => [
  { name: 'edit', label: t('card.edit') },
  { name: 'export', label: t('card.export') },
  { name: 'delete', label: t('card.delete') },
];
const profileCardActions = (t: TFunction) => [{ name: 'share', label: t('profiles.share') }];

/** Press feedback for a selectable card: a slight shrink, left out under Reduce motion (plan 20). */
function cardPressStyle(reduceMotion: boolean) {
  return reduceMotion ? { opacity: 0.85 } : { opacity: 0.85, scale: 0.99 };
}

function GarageCard({
  v,
  active,
  onSelect,
  onEdit,
  onExport,
}: {
  v: UserVehicle;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onExport: () => void;
}) {
  const { t } = useTranslation('vehicleSelect');
  const suffix = vinSuffix(v.learned?.vin);
  const fuel = t(`common:fuel.${v.fuel}`, { defaultValue: v.fuel });
  const base = getVehicleProfile(v.baseProfileId);
  const palette = usePalette();
  const reduceMotion = useReducedMotion();
  const protocol = v.learned ? PROTOCOL_LABELS[v.learned.protocol] : t('card.byHand');
  const confirmDelete = () =>
    appAlert(t('card.deleteTitle'), t('card.deleteBody', { name: v.name }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('card.delete'),
        style: 'destructive',
        onPress: () => deleteGarageVehicle(v.id),
      },
    ]);
  return (
    <Card
      bordered
      padding="$4"
      backgroundColor="$backgroundHover"
      borderColor={active ? '$accent' : '$borderColor'}
      borderWidth={active ? 2 : 1}
      borderLeftWidth={active ? 4 : 1}
      borderLeftColor={active ? '$accent' : '$borderColor'}
      pressStyle={cardPressStyle(reduceMotion)}
      // One element for the screen reader (plan 20); the Edit / Export / Delete buttons inside are
      // also offered as its actions, since VoiceOver does not reach controls inside an element.
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${v.name}. ${protocol}. ${active ? t('card.selected') : t('card.notSelected')}`}
      accessibilityHint={t('card.selectHint')}
      accessibilityState={{ selected: active }}
      accessibilityActions={garageCardActions(t)}
      onAccessibilityAction={(e) => {
        const action = e.nativeEvent.actionName;
        if (action === 'edit' || action === 'longpress') onEdit();
        else if (action === 'export') onExport();
        else if (action === 'delete') confirmDelete();
      }}
      onPress={onSelect}
      onLongPress={onEdit}
    >
      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontWeight="800" fontSize="$5" flex={1}>
            {v.name}
            {suffix ? ` ·${suffix}` : ''}
          </Text>
          {active ? <CheckCircle2 size={20} color={palette.accent} /> : null}
        </XStack>
        <XStack gap="$2" flexWrap="wrap">
          {v.year ? <Chip>{v.year}</Chip> : null}
          <Chip>{fuel}</Chip>
          {v.learned ? (
            <Chip>{PROTOCOL_LABELS[v.learned.protocol]}</Chip>
          ) : (
            <Chip>{t('card.byHand')}</Chip>
          )}
          {v.learned ? (
            <Chip>{t('card.pids', { count: v.learned.supportedPids.length })}</Chip>
          ) : null}
        </XStack>
        <Paragraph theme="alt2" fontSize="$2">
          {t('card.basedOn', { name: base.name })}
          {v.learned?.vin ? ` · VIN ${v.learned.vin}` : ''}
        </Paragraph>
        {v.notes ? (
          <Paragraph theme="alt2" fontSize="$2" numberOfLines={2}>
            {v.notes}
          </Paragraph>
        ) : null}
        <XStack gap="$2">
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            onPress={onEdit}
            accessibilityLabel={t('card.editA11y', { name: v.name })}
          >
            {t('card.edit')}
          </Button>
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            onPress={onExport}
            accessibilityLabel={t('card.exportA11y', { name: v.name })}
          >
            {t('card.export')}
          </Button>
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            theme="red"
            onPress={confirmDelete}
            accessibilityLabel={t('card.deleteA11y', { name: v.name })}
          >
            {t('card.delete')}
          </Button>
        </XStack>
      </YStack>
    </Card>
  );
}

export function VehicleSelectScreen() {
  const { t } = useTranslation('vehicleSelect');
  const router = useRouter();
  const palette = usePalette();
  const reduceMotion = useReducedMotion();
  const selectedProfileId = useVehicleStore((s) => s.selectedProfileId);
  const select = useVehicleStore((s) => s.select);
  const garage = useGarageStore((s) => s.vehicles);
  const info = useSessionStore((s) => s.info);
  const connected = useSessionStore((s) => s.status === 'connected' && !!s.info);
  const vin = info?.vin ?? null;
  const [editor, setEditor] = useState<{ vehicle: UserVehicle | null } | null>(null);
  const importer = useExchangeImport(EXCHANGE_SOURCE);
  const [exportNote, setExportNote] = useState<string | null>(null);

  // A garage car learned with this VIN wins over a registry suggestion.
  const garageMatch = pickVehicleForVin(vin, garage);
  const suggestion = garageMatch ? undefined : suggestProfilesForVin(vin, VEHICLE_PROFILES)[0];
  const suggestDifferent = suggestion && suggestion.profile.id !== selectedProfileId;
  const garageDifferent = garageMatch && garageMatch.id !== selectedProfileId;

  const pick = (id: string) => {
    select(id);
    router.push('/dashboard');
  };
  // When the connected VIN already belongs to a garage car, the action re-learns that car in place
  // (keeping its name / fuel / notes) instead of adding a duplicate with the same VIN.
  const relearn = connected && garageMatch ? garageMatch : null;
  const addFromCar = () => {
    const learned = relearn
      ? learnFromConnectedCar({ existingId: relearn.id })
      : learnFromConnectedCar();
    if (learned) router.push('/dashboard');
  };
  const exported = (uri: string | null) => {
    if (!uri && isWebRuntime()) return; // the "not available on web yet" toast already said why
    setExportNote(
      uri ? t('export.saved', { file: uri.slice(uri.lastIndexOf('/') + 1) }) : t('export.failed'),
    );
  };
  const exportCar = async (v: UserVehicle) => exported(await shareVehicleFile(v));
  const exportSeed = async (p: VehicleProfile) => exported(await shareProfileSeedFile(p));

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <YStack gap="$3">
        {garageDifferent ? (
          <Card
            bordered
            padding="$3"
            borderColor="$accent"
            pressStyle={{ opacity: 0.85 }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t('match.garageA11y', { name: garageMatch.name })}
            onPress={() => pick(garageMatch.id)}
          >
            <Paragraph size="$2">
              <Trans
                i18nKey="vehicleSelect:match.garage"
                values={{ name: garageMatch.name }}
                components={{ b: <Text fontWeight="800" /> }}
              />
            </Paragraph>
          </Card>
        ) : null}
        {suggestDifferent ? (
          <Card
            bordered
            padding="$3"
            borderColor="$accent"
            pressStyle={{ opacity: 0.85 }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t('match.profileA11y', { name: suggestion.profile.name })}
            onPress={() => pick(suggestion.profile.id)}
          >
            <Paragraph size="$2">
              <Trans
                i18nKey="vehicleSelect:match.profile"
                values={{ vin, name: suggestion.profile.name }}
                components={{ b: <Text fontWeight="800" /> }}
              />
            </Paragraph>
          </Card>
        ) : null}

        <YStack gap="$2">
          <H4>{t('garage.title')}</H4>
          <Paragraph theme="alt2" fontSize="$2">
            {t(GARAGE_COPY)}
          </Paragraph>
          <XStack gap="$2">
            <Button
              flex={1}
              theme="green"
              disabled={!connected}
              opacity={connected ? 1 : 0.5}
              onPress={addFromCar}
            >
              {relearn ? t('garage.relearn') : t('garage.addFromCar')}
            </Button>
            <Button flex={1} onPress={() => setEditor({ vehicle: null })}>
              {t('garage.addManually')}
            </Button>
          </XStack>
          <Button
            disabled={importer.busy}
            onPress={() => void importer.startImport()}
            accessibilityLabel={t('garage.importA11y')}
          >
            {t('garage.import')}
          </Button>
          {importer.note ? (
            <Paragraph theme="alt2" fontSize="$1">
              {importer.note}
            </Paragraph>
          ) : null}
          {exportNote ? (
            <Paragraph theme="alt2" fontSize="$1" testID="profile-export-note">
              {exportNote}
            </Paragraph>
          ) : null}
          {relearn ? (
            <Paragraph theme="alt2" fontSize="$1">
              {t('garage.relearnNote', { name: relearn.name })}
            </Paragraph>
          ) : null}
          {!connected ? (
            <Paragraph theme="alt2" fontSize="$1">
              {t('garage.connectFirst')}
            </Paragraph>
          ) : null}
          {garage.length === 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              {t('garage.empty')}
            </Paragraph>
          ) : null}
          {/* Two columns on a tablet / landscape phone (plan 21). */}
          <CardGrid testID="garage-grid">
            {garage.map((v) => (
              <GarageCard
                key={v.id}
                v={v}
                active={v.id === selectedProfileId}
                onSelect={() => pick(v.id)}
                onEdit={() => setEditor({ vehicle: v })}
                onExport={() => void exportCar(v)}
              />
            ))}
          </CardGrid>
        </YStack>

        <H4>{t('profiles.title')}</H4>
        <CardGrid testID="profiles-grid" gap={12}>
          {VEHICLE_PROFILES.map((p) => {
            const active = p.id === selectedProfileId;
            return (
              <Card
                key={p.id}
                bordered
                padding="$4"
                backgroundColor="$backgroundHover"
                borderColor={active ? '$accent' : '$borderColor'}
                borderWidth={active ? 2 : 1}
                borderLeftWidth={active ? 4 : 1}
                borderLeftColor={active ? '$accent' : '$borderColor'}
                pressStyle={cardPressStyle(reduceMotion)}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`${p.name}. ${PROTOCOL_LABELS[p.expectedProtocol]}. ${active ? t('card.selected') : t('card.notSelected')}`}
                accessibilityState={{ selected: active }}
                accessibilityActions={p.id === 'generic' ? undefined : profileCardActions(t)}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'share') void exportSeed(p);
                }}
                onPress={() => pick(p.id)}
              >
                <YStack gap="$2">
                  <XStack justifyContent="space-between" alignItems="center">
                    <Text fontWeight="800" fontSize="$5" flex={1}>
                      {p.name}
                    </Text>
                    {active ? <CheckCircle2 size={20} color={palette.accent} /> : null}
                  </XStack>
                  <Chip>
                    {PROTOCOL_LABELS[p.expectedProtocol]}
                    {p.extendedPids?.length ? ` · ${t('profiles.experimental')}` : ''}
                  </Chip>
                  {p.notes ? (
                    <Paragraph theme="alt2" fontSize="$2" numberOfLines={3}>
                      {p.notes}
                    </Paragraph>
                  ) : null}
                  {p.id !== 'generic' ? (
                    <XStack>
                      <Button
                        size="$3"
                        hitSlop={HIT_SLOP}
                        onPress={() => void exportSeed(p)}
                        accessibilityLabel={t('profiles.shareA11y', { name: p.name })}
                      >
                        {t('profiles.share')}
                      </Button>
                    </XStack>
                  ) : null}
                </YStack>
              </Card>
            );
          })}
        </CardGrid>
      </YStack>
      <VehicleEditorSheet
        open={editor !== null}
        vehicle={editor?.vehicle ?? null}
        onClose={() => setEditor(null)}
      />
      <ImportPreviewSheet pending={importer.pending} onClose={importer.close} />
    </Screen>
  );
}
