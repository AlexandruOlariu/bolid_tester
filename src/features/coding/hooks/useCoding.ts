import { useCallback, useMemo } from 'react';
import {
  codeModule,
  isCan,
  setBit,
  getBit,
  setByte,
  diffCoding,
  mergeCodingLabels,
  applyPreset,
  revertPreset,
  detectPresetState,
  type CodingField,
  type CodingPreset,
  type CodingPresetState,
} from '@/shared/obd-core';
import type { CodingModule } from '@/shared/vehicles';
import { codingBitLabels } from '@/shared/labels';
import { useLabelPackFinder } from '@/shared/state/labelPackStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { activeSeedKeyVehicleKeys, decideSecurity, resolveSeedKey } from '@/shared/security';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import {
  scannedPartNumber,
  useModuleScanStore,
} from '@/features/module-scan/model/moduleScanStore';
import { useCodingStore } from '../model/codingStore';
import { translate } from '@/shared/i18n';

/** SAFETY: read→backup→write→verify, gated on unlock + CAN. Never writes without a stored backup. */
export function useCoding() {
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const unlocked = useCodingStore((s) => s.unlocked);
  const current = useCodingStore((s) => s.current);
  const setCurrent = useCodingStore((s) => s.setCurrent);
  const addBackup = useCodingStore((s) => s.addBackup);
  const setLastResult = useCodingStore((s) => s.setLastResult);

  const available = !!profile.codingModules?.length && isCan(session?.currentProtocol ?? 'UNKNOWN');
  // Stable per-profile so the `[modules]`-keyed callbacks below (moduleForPreset) don't re-create on
  // every render — `?? []` would otherwise mint a fresh array each pass (react-hooks/exhaustive-deps).
  const modules = useMemo(() => profile.codingModules ?? [], [profile]);
  const presets = profile.codingPresets ?? [];

  /** The working coding for a module: last read/edited value, else the profile's sample. */
  const currentFor = useCallback(
    (mod: CodingModule): number[] => current[mod.module] ?? mod.sampleCoding,
    [current],
  );

  /** The part number the live module scan read from `mod` — what security-access plugin matching
   *  uses (plan 23). Never the profile's `mod.partNumber`, which is illustrative: a plugin scoped
   *  by part-number prefix must not match a module whose real part number is unknown. */
  const scanResults = useModuleScanStore((s) => s.results);
  const partNumberFor = useCallback(
    (mod: CodingModule): string | undefined => scannedPartNumber(scanResults, mod.reqHeader),
    [scanResults],
  );

  /** Long-coding fields = the module's own schema merged additively with any label-pack coding-bit
   *  names resolved from its part number (the profile schema always wins on a conflict). */
  // The label-pack lookup re-resolves when the imported packs change (plan 13).
  const findLabelPack = useLabelPackFinder();
  const fieldsFor = useCallback(
    (mod: CodingModule): CodingField[] => {
      const pack = findLabelPack(mod.partNumber);
      return mergeCodingLabels(mod.schema, codingBitLabels(pack, mod.codingDid));
    },
    [findLabelPack],
  );

  const read = useCallback(
    async (mod: CodingModule) => {
      if (!session) return null;
      try {
        await session.setHeader(mod.reqHeader);
        await session.setRxFilter(mod.rxFilter);
        const bytes = await session.readExtended(mod.codingDid);
        if (bytes) setCurrent(mod.module, bytes);
        return bytes;
      } catch (e) {
        logError({
          source: 'coding/read',
          error: e,
          context: { module: mod.module, did: mod.codingDid },
        });
        return null;
      } finally {
        await session.resetAddressing();
      }
    },
    [session, setCurrent],
  );

  const toggleBit = (mod: CodingModule, bytes: number[], byte: number, bit: number) => {
    const next = setBit(bytes, byte, bit, getBit(bytes, byte, bit) ? 0 : 1);
    setCurrent(mod.module, next);
    return next;
  };

  /** Set a masked field (e.g. a nibble) in place, immutably, and store it as the working value. */
  const setField = (
    mod: CodingModule,
    bytes: number[],
    byte: number,
    mask: number,
    value: number,
  ) => {
    const cur = bytes[byte] ?? 0;
    const next = setByte(bytes, byte, (cur & ~mask) | (value & mask));
    setCurrent(mod.module, next);
    return next;
  };

  const write = useCallback(
    async (mod: CodingModule, newData: number[]) => {
      if (!session || !unlocked) {
        setLastResult(translate('coding:locked'));
        return false;
      }
      // SecurityAccess (plan 23): only with an installed plugin for this module; otherwise refuse
      // before any bus traffic — never a made-up key (a wrong key burns one of few attempts).
      const decision = decideSecurity(
        mod.security,
        mod.security
          ? await resolveSeedKey({
              reqHeader: mod.reqHeader,
              level: mod.security.level,
              // Read at write time from the live scan, never the profile's illustrative number.
              partNumber: scannedPartNumber(useModuleScanStore.getState().results, mod.reqHeader),
              vehicleKeys: activeSeedKeyVehicleKeys(),
            })
          : null,
      );
      if (decision.kind === 'refuse') {
        setLastResult(decision.message);
        return false;
      }
      await session.setHeader(mod.reqHeader);
      await session.setRxFilter(mod.rxFilter);
      try {
        const res = await codeModule((cmd) => session.send(cmd), {
          did: mod.codingDid,
          newData,
          security: decision.kind === 'unlock' ? decision.security : undefined,
        });
        addBackup({ module: mod.module, did: mod.codingDid, bytes: res.backup, at: Date.now() });
        if (res.verified) setCurrent(mod.module, newData);
        if (!res.verified) {
          logError({
            source: 'coding/write',
            error: 'Write sent but verification failed',
            severity: 'warning',
            context: { module: mod.module, did: mod.codingDid },
          });
        }
        setLastResult(res.verified ? translate('coding:verified') : translate('coding:unverified'));
        return res.verified;
      } catch (e) {
        logError({
          source: 'coding/write',
          error: e,
          context: { module: mod.module, did: mod.codingDid },
        });
        setLastResult(translate('coding:failed', { error: (e as Error).message }));
        return false;
      } finally {
        await session.resetAddressing();
      }
    },
    [session, unlocked, addBackup, setCurrent, setLastResult],
  );

  /** The codeable module a preset targets (linked by ATSH request header). */
  const moduleForPreset = useCallback(
    (preset: CodingPreset): CodingModule | undefined =>
      modules.find((m) => m.reqHeader === preset.reqHeader),
    [modules],
  );

  /** Current on/off/unknown state of a one-tap tweak, from the working coding value. */
  const presetState = useCallback(
    (preset: CodingPreset): CodingPresetState => {
      const mod = moduleForPreset(preset);
      if (!mod) return 'unknown';
      return detectPresetState(currentFor(mod), preset);
    },
    [moduleForPreset, currentFor],
  );

  /** Apply (on=true) or revert (on=false) a one-tap tweak through the SAME gated write: read the
   *  live coding first (backup-first), compile the preset onto it, then write + verify. */
  const applyTweak = useCallback(
    async (preset: CodingPreset, on: boolean) => {
      const mod = moduleForPreset(preset);
      if (!mod) return false;
      if (!session || !unlocked) {
        setLastResult(translate('coding:locked'));
        return false;
      }
      // Always start from the real, freshly-read coding so the tweak never overwrites unknown bits.
      const base = (await read(mod)) ?? currentFor(mod);
      const next = on ? applyPreset(base, preset) : revertPreset(base, preset);
      return write(mod, next);
    },
    [moduleForPreset, session, unlocked, read, currentFor, write, setLastResult],
  );

  return {
    available,
    modules,
    presets,
    read,
    write,
    toggleBit,
    setField,
    diffCoding,
    fieldsFor,
    currentFor,
    moduleForPreset,
    presetState,
    applyTweak,
    partNumberFor,
  };
}
