import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, YStack, XStack, Text, Paragraph, Button, H4 } from 'tamagui';
import { CheckCircle2 } from 'lucide-react-native';
import { Screen } from '@/shared/ui';
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
import { FUELS } from '../model/vehicleDraft';
import { deleteGarageVehicle, learnFromConnectedCar } from '../api/learnVehicle';
import { EXCHANGE_SOURCE, shareProfileSeedFile, shareVehicleFile } from '../api/exchange';
import { VehicleEditorSheet } from './VehicleEditorSheet';

const GREEN = '#2bb673';
export const GARAGE_COPY =
  'Cars you add here are remembered on this phone. Built-in profiles are curated and documented.';

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
  const suffix = vinSuffix(v.learned?.vin);
  const fuel = FUELS.find((f) => f.value === v.fuel)?.label ?? v.fuel;
  const base = getVehicleProfile(v.baseProfileId);
  const confirmDelete = () =>
    Alert.alert(
      'Delete this car?',
      `${v.name} is removed from your garage. Its history, scans and trips stay on this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteGarageVehicle(v.id) },
      ],
    );
  return (
    <Card
      bordered
      padding="$4"
      backgroundColor="$backgroundHover"
      borderColor={active ? GREEN : '$borderColor'}
      borderWidth={active ? 2 : 1}
      borderLeftWidth={active ? 4 : 1}
      borderLeftColor={active ? GREEN : '$borderColor'}
      pressStyle={{ opacity: 0.85, scale: 0.99 }}
      onPress={onSelect}
      onLongPress={onEdit}
    >
      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontWeight="800" fontSize="$5" flex={1}>
            {v.name}
            {suffix ? ` ·${suffix}` : ''}
          </Text>
          {active ? <CheckCircle2 size={20} color={GREEN} /> : null}
        </XStack>
        <XStack gap="$2" flexWrap="wrap">
          {v.year ? <Chip>{v.year}</Chip> : null}
          <Chip>{fuel}</Chip>
          {v.learned ? (
            <Chip>{PROTOCOL_LABELS[v.learned.protocol]}</Chip>
          ) : (
            <Chip>added by hand</Chip>
          )}
          {v.learned ? <Chip>{v.learned.supportedPids.length} PIDs</Chip> : null}
        </XStack>
        <Paragraph theme="alt2" fontSize="$2">
          Based on {base.name}
          {v.learned?.vin ? ` · VIN ${v.learned.vin}` : ''}
        </Paragraph>
        {v.notes ? (
          <Paragraph theme="alt2" fontSize="$2" numberOfLines={2}>
            {v.notes}
          </Paragraph>
        ) : null}
        <XStack gap="$2">
          <Button size="$2" onPress={onEdit} accessibilityLabel={`Edit ${v.name}`}>
            Edit
          </Button>
          <Button size="$2" onPress={onExport} accessibilityLabel={`Export ${v.name}`}>
            Export
          </Button>
          <Button
            size="$2"
            theme="red"
            onPress={confirmDelete}
            accessibilityLabel={`Delete ${v.name}`}
          >
            Delete
          </Button>
        </XStack>
      </YStack>
    </Card>
  );
}

export function VehicleSelectScreen() {
  const router = useRouter();
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
  const exported = (uri: string | null) =>
    setExportNote(
      uri
        ? `Saved ${uri.slice(uri.lastIndexOf('/') + 1)}.`
        : 'Could not export the profile. See More → Error log for details.',
    );
  const exportCar = async (v: UserVehicle) => exported(await shareVehicleFile(v));
  const exportSeed = async (p: VehicleProfile) => exported(await shareProfileSeedFile(p));

  return (
    <Screen title="Vehicle" subtitle="Pick a car, or use Auto / Generic for any OBD2 car">
      <YStack gap="$3">
        {garageDifferent ? (
          <Card
            bordered
            padding="$3"
            borderColor={GREEN}
            pressStyle={{ opacity: 0.85 }}
            onPress={() => pick(garageMatch.id)}
          >
            <Paragraph size="$2">
              The connected car is <Text fontWeight="800">{garageMatch.name}</Text> from your garage
              — tap to switch to it.
            </Paragraph>
          </Card>
        ) : null}
        {suggestDifferent ? (
          <Card
            bordered
            padding="$3"
            borderColor={GREEN}
            pressStyle={{ opacity: 0.85 }}
            onPress={() => pick(suggestion.profile.id)}
          >
            <Paragraph size="$2">
              The connected car's VIN ({vin}) matches{' '}
              <Text fontWeight="800">{suggestion.profile.name}</Text> — tap to switch to that
              profile.
            </Paragraph>
          </Card>
        ) : null}

        <YStack gap="$2">
          <H4>My garage</H4>
          <Paragraph theme="alt2" fontSize="$2">
            {GARAGE_COPY}
          </Paragraph>
          <XStack gap="$2">
            <Button
              flex={1}
              theme="green"
              disabled={!connected}
              opacity={connected ? 1 : 0.5}
              onPress={addFromCar}
            >
              {relearn ? 'Re-learn from connected car' : 'Add from connected car'}
            </Button>
            <Button flex={1} onPress={() => setEditor({ vehicle: null })}>
              Add manually
            </Button>
          </XStack>
          <Button
            disabled={importer.busy}
            onPress={() => void importer.startImport()}
            accessibilityLabel="Import a car profile from a file"
          >
            Import profile
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
              The connected car is already in your garage as {relearn.name} — re-learning refreshes
              its protocol and supported readings and keeps its name and notes.
            </Paragraph>
          ) : null}
          {!connected ? (
            <Paragraph theme="alt2" fontSize="$1">
              Connect to a car first to add it from the connection — the app reads its VIN, protocol
              and supported readings.
            </Paragraph>
          ) : null}
          {garage.length === 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              No cars in your garage yet.
            </Paragraph>
          ) : null}
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
        </YStack>

        <H4>Built-in profiles</H4>
        {VEHICLE_PROFILES.map((p) => {
          const active = p.id === selectedProfileId;
          return (
            <Card
              key={p.id}
              bordered
              padding="$4"
              backgroundColor="$backgroundHover"
              borderColor={active ? GREEN : '$borderColor'}
              borderWidth={active ? 2 : 1}
              borderLeftWidth={active ? 4 : 1}
              borderLeftColor={active ? GREEN : '$borderColor'}
              pressStyle={{ opacity: 0.85, scale: 0.99 }}
              onPress={() => pick(p.id)}
            >
              <YStack gap="$2">
                <XStack justifyContent="space-between" alignItems="center">
                  <Text fontWeight="800" fontSize="$5" flex={1}>
                    {p.name}
                  </Text>
                  {active ? <CheckCircle2 size={20} color={GREEN} /> : null}
                </XStack>
                <Chip>
                  {PROTOCOL_LABELS[p.expectedProtocol]}
                  {p.extendedPids?.length ? ' · experimental' : ''}
                </Chip>
                {p.notes ? (
                  <Paragraph theme="alt2" fontSize="$2" numberOfLines={3}>
                    {p.notes}
                  </Paragraph>
                ) : null}
                {p.id !== 'generic' ? (
                  <XStack>
                    <Button
                      size="$2"
                      onPress={() => void exportSeed(p)}
                      accessibilityLabel={`Share ${p.name} as a starting profile`}
                    >
                      Share as starting profile
                    </Button>
                  </XStack>
                ) : null}
              </YStack>
            </Card>
          );
        })}
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
