import React, { useState } from 'react';
import { Sheet, YStack, XStack, Text, Paragraph, Button, Input, TextArea } from 'tamagui';
import { useGarageStore } from '@/shared/state/garageStore';
import { SegmentedControl, HIT_SLOP } from '@/shared/ui';
import { formatLoginCode } from '@/shared/obd-core';
import {
  MASKED_LOGIN_CODE,
  VEHICLE_NAME_MAX,
  VEHICLE_NOTES_MAX,
  VEHICLE_PROFILES,
  removeLoginCode,
  type LoginCodeEntry,
  type UserVehicle,
} from '@/shared/vehicles';
import {
  FUEL_VALUES,
  draftFromVehicle,
  draftToVehicle,
  emptyDraft,
  validateDraft,
  type VehicleDraft,
} from '../model/vehicleDraft';
import { useGarageExport } from '../hooks/useGarageExport';
import { useTranslation } from '@/shared/i18n';

/** Add or edit a garage car (plan 06): name, year, fuel, the built-in profile it inherits from and
 *  notes; for an existing car also its **login codes** (plan 22 code book: remembered on the
 *  Adaptations screen, listed masked here, deleted on Save). `vehicle` null + `open` = add a new car; a vehicle = edit it. The footer shares the whole
 *  garage as JSON. See docs/features/vehicle-select.md. */
export function VehicleEditorSheet({
  open,
  vehicle,
  onClose,
  onSaved,
}: {
  open: boolean;
  vehicle: UserVehicle | null;
  onClose: () => void;
  /** Called with the saved car (new or updated). */
  onSaved?: (v: UserVehicle) => void;
}) {
  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(o: boolean) => {
        if (!o) onClose();
      }}
      snapPoints={[90]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame padding="$4">
        <Sheet.ScrollView>
          {open ? (
            <EditorBody
              key={vehicle?.id ?? 'new'}
              vehicle={vehicle}
              onClose={onClose}
              onSaved={onSaved}
            />
          ) : null}
        </Sheet.ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}

export function EditorBody({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: UserVehicle | null;
  onClose: () => void;
  onSaved?: (v: UserVehicle) => void;
}) {
  const { t } = useTranslation('vehicleSelect');
  const [draft, setDraft] = useState<VehicleDraft>(() =>
    vehicle ? draftFromVehicle(vehicle) : emptyDraft(),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [loginCodes, setLoginCodes] = useState<LoginCodeEntry[]>(() => vehicle?.loginCodes ?? []);
  const [revealed, setRevealed] = useState<string | null>(null);
  const { exportGarage, busy } = useGarageExport();
  const errors = validateDraft(draft);
  const set = (patch: Partial<VehicleDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    const fields = draftToVehicle(draft);
    const garage = useGarageStore.getState();
    if (vehicle) {
      garage.update(vehicle.id, {
        ...fields,
        loginCodes: loginCodes.length ? loginCodes : undefined,
      });
      const saved = useGarageStore.getState().vehicles.find((v) => v.id === vehicle.id);
      if (saved) onSaved?.(saved);
    } else {
      onSaved?.(garage.add(fields));
    }
    onClose();
  };

  const err = (k: keyof VehicleDraft) =>
    showErrors && errors[k] ? (
      <Paragraph color="$statusError" fontSize="$2">
        {errors[k]}
      </Paragraph>
    ) : null;

  return (
    <YStack gap="$3" paddingBottom="$6">
      <Text fontWeight="800" fontSize="$6">
        {vehicle ? t('editor.editTitle') : t('editor.addTitle')}
      </Text>

      <YStack gap="$1">
        <Paragraph fontWeight="700">{t('editor.name')}</Paragraph>
        <Input
          value={draft.name}
          onChangeText={(name) => set({ name })}
          placeholder={t('editor.namePlaceholder')}
          maxLength={VEHICLE_NAME_MAX}
          accessibilityLabel={t('editor.nameA11y')}
        />
        {err('name')}
      </YStack>

      <YStack gap="$1">
        <Paragraph fontWeight="700">{t('editor.year')}</Paragraph>
        <Input
          value={draft.year}
          onChangeText={(year) => set({ year: year.replace(/\D/g, '').slice(0, 4) })}
          keyboardType="numeric"
          placeholder={t('editor.yearPlaceholder')}
          accessibilityLabel={t('editor.yearA11y')}
        />
        {err('year')}
      </YStack>

      <YStack gap="$1">
        <Paragraph fontWeight="700">{t('editor.fuel')}</Paragraph>
        <SegmentedControl
          label={t('editor.fuel')}
          options={FUEL_VALUES.map((value) => ({ value, label: t(`common:fuel.${value}`) }))}
          value={draft.fuel}
          onChange={(fuel) => set({ fuel })}
        />
      </YStack>

      <YStack gap="$1">
        <Paragraph fontWeight="700">{t('editor.baseProfile')}</Paragraph>
        <Paragraph theme="alt2" fontSize="$2">
          {t('editor.baseProfileHelp')}
        </Paragraph>
        <SegmentedControl
          label={t('editor.baseProfile')}
          vertical
          options={VEHICLE_PROFILES.map((p) => ({ value: p.id, label: p.name }))}
          value={draft.baseProfileId}
          onChange={(baseProfileId) => set({ baseProfileId })}
        />
        {err('baseProfileId')}
      </YStack>

      <YStack gap="$1">
        <Paragraph fontWeight="700">{t('editor.notes')}</Paragraph>
        <TextArea
          value={draft.notes}
          onChangeText={(notes) => set({ notes })}
          placeholder={t('editor.notesPlaceholder')}
          maxLength={VEHICLE_NOTES_MAX}
          accessibilityLabel={t('editor.notes')}
        />
        {err('notes')}
      </YStack>

      {vehicle ? (
        <YStack gap="$2">
          <Paragraph fontWeight="700">{t('editor.loginCodes')}</Paragraph>
          <Paragraph theme="alt2" fontSize="$2">
            {t('editor.loginCodesHelp')}
          </Paragraph>
          {loginCodes.length === 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              {t('editor.noLoginCodes')}
            </Paragraph>
          ) : (
            loginCodes.map((e) => (
              <XStack
                key={e.address}
                gap="$2"
                alignItems="center"
                backgroundColor="$color2"
                padding="$2"
                borderRadius="$3"
              >
                <YStack flex={1}>
                  <Paragraph fontWeight="700">
                    {t('editor.module', { address: e.address })}
                    {e.purpose ? ` · ${e.purpose}` : ''}
                  </Paragraph>
                  <Paragraph theme="alt2" fontSize="$2">
                    {t('editor.code', {
                      code: revealed === e.address ? formatLoginCode(e.code) : MASKED_LOGIN_CODE,
                    })}
                  </Paragraph>
                </YStack>
                <Button
                  size="$3"
                  hitSlop={HIT_SLOP}
                  onPress={() => setRevealed((r) => (r === e.address ? null : e.address))}
                  accessibilityLabel={
                    revealed === e.address
                      ? t('editor.hideCodeA11y', { address: e.address })
                      : t('editor.showCodeA11y', { address: e.address })
                  }
                >
                  {revealed === e.address ? t('editor.hide') : t('editor.show')}
                </Button>
                <Button
                  size="$3"
                  hitSlop={HIT_SLOP}
                  theme="red"
                  onPress={() => setLoginCodes((l) => removeLoginCode(l, e.address))}
                  accessibilityLabel={t('editor.deleteCodeA11y', { address: e.address })}
                >
                  {t('card.delete')}
                </Button>
              </XStack>
            ))
          )}
        </YStack>
      ) : null}

      <XStack gap="$3">
        <Button flex={1} onPress={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button flex={1} theme="green" onPress={save}>
          {t('editor.save')}
        </Button>
      </XStack>

      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        theme="gray"
        onPress={() => void exportGarage()}
        disabled={busy}
      >
        {t('editor.shareGarage')}
      </Button>
      <Paragraph theme="alt2" fontSize="$1">
        {t('editor.shareGarageHelp')}
      </Paragraph>
    </YStack>
  );
}
