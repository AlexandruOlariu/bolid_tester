/** Unlock status for the write surfaces (plan 23): which installed security-access plugin, if
 *  any, unlocks a module for the active car. The hook re-renders when a plugin is imported or
 *  deleted, the car changes or the session reports a VIN. */
import { useMemo } from 'react';
import { getActiveProfile, useActiveProfile } from '@/shared/state/activeProfile';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSeedKeyStore } from '@/shared/state/seedKeyStore';
import {
  decideSecurity,
  matchSeedKeyPlugin,
  resolveSeedKey,
  seedKeyVehicleKeys,
  unlockStatusFor,
  type SecurityDecision,
  type SeedKeyTarget,
  type UnlockStatus,
} from './resolveSeedKey';

/** Non-hook: the active car's plugin keys right now (for a write's resolution). */
export function activeSeedKeyVehicleKeys(): string[] {
  return seedKeyVehicleKeys(getActiveProfile().id, useSessionStore.getState().info?.vin ?? null);
}

/** Hook: the active car's plugin keys. */
export function useSeedKeyVehicleKeys(): string[] {
  const profile = useActiveProfile();
  const vin = useSessionStore((s) => s.info?.vin ?? null);
  return useMemo(() => seedKeyVehicleKeys(profile.id, vin), [profile.id, vin]);
}

/** The badge state for one module that may declare `security`. */
export function useUnlockStatus(
  security: { level: number } | undefined,
  target: Omit<SeedKeyTarget, 'level' | 'vehicleKeys'>,
): UnlockStatus {
  const plugins = useSeedKeyStore((s) => s.plugins);
  const keys = useSeedKeyVehicleKeys();
  const { reqHeader, address, partNumber } = target;
  const level = security?.level;
  return useMemo(() => {
    if (level === undefined) return unlockStatusFor(undefined, null);
    const plugin = matchSeedKeyPlugin(plugins, {
      reqHeader,
      address,
      partNumber,
      level,
      vehicleKeys: keys,
    });
    return unlockStatusFor({ level }, plugin);
  }, [plugins, keys, reqHeader, address, partNumber, level]);
}

/** Resolve the active car's plugin for one module and decide what its write does (plan 23):
 *  nothing, unlock with the routine, or refuse before any bus traffic. */
export async function securityDecisionForActiveCar(
  security: { level: number } | undefined,
  target: Omit<SeedKeyTarget, 'level' | 'vehicleKeys'>,
): Promise<SecurityDecision> {
  if (!security) return { kind: 'none' };
  const resolved = await resolveSeedKey({
    ...target,
    level: security.level,
    vehicleKeys: activeSeedKeyVehicleKeys(),
  });
  return decideSecurity(security, resolved);
}

/** Non-hook: whether an installed plugin unlocks this module for the active car right now. */
export function hasSeedKeyPluginFor(
  security: { level: number } | undefined,
  target: Omit<SeedKeyTarget, 'level' | 'vehicleKeys'>,
): boolean {
  if (!security) return false;
  return !!matchSeedKeyPlugin(useSeedKeyStore.getState().plugins, {
    ...target,
    level: security.level,
    vehicleKeys: activeSeedKeyVehicleKeys(),
  });
}
