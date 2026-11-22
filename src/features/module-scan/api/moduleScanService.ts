/** Per-module scan service: address one module (ATSH/ATCRA), read ident + DTCs, restore the
 *  header. Pure orchestration over DiagnosticSession — the UDS parsing lives in
 *  obd-core/uds/udsModule (unit-tested). See docs/features/module-scan.md. */

import {
  DiagnosticSession,
  readModuleDtcs,
  readModuleIdent,
  clearModuleDtcs,
  isModuleUnreachableError,
} from '@/shared/obd-core';
import type { DiagModule } from '@/shared/vehicles';
import type { ModuleScanResult } from '../model/moduleScanStore';
import { translate } from '@/shared/i18n';

export async function scanModule(
  session: DiagnosticSession,
  module: DiagModule,
): Promise<ModuleScanResult> {
  if (module.transport !== 'uds' || !module.reqHeader) {
    return {
      module,
      state: 'skipped',
      reason: translate('moduleScan:reason.tp20'),
      dtcs: [],
    };
  }
  const reqHeader = module.reqHeader;
  const send = (cmd: string) => session.send(cmd);
  // The header block runs inside `session.exclusive`: no live poll sweep (or other addressed block)
  // can go out while the adapter is addressed at this module.
  return session.exclusive(async (): Promise<ModuleScanResult> => {
    try {
      await session.setHeader(reqHeader);
      if (module.rxFilter) await session.setRxFilter(module.rxFilter);
      const ident = await readModuleIdent(send);
      const dtcs = await readModuleDtcs(send, 0xff);
      return { module, state: 'ok', ident, dtcs };
    } catch (e) {
      const msg = (e as Error).message;
      if (isModuleUnreachableError(msg)) {
        return {
          module,
          state: 'silent',
          reason: translate('moduleScan:reason.silent'),
          dtcs: [],
        };
      }
      return { module, state: 'error', reason: msg, dtcs: [] };
    } finally {
      await session.resetAddressing();
    }
  });
}

/** Clear one module's DTC store (0x14 FFFFFF), then re-scan it for the fresh state. */
export async function clearModule(
  session: DiagnosticSession,
  module: DiagModule,
): Promise<ModuleScanResult> {
  if (module.transport !== 'uds' || !module.reqHeader) {
    return {
      module,
      state: 'skipped',
      reason: translate('moduleScan:reason.notClearable'),
      dtcs: [],
    };
  }
  const reqHeader = module.reqHeader;
  await session.exclusive(async () => {
    try {
      await session.setHeader(reqHeader);
      if (module.rxFilter) await session.setRxFilter(module.rxFilter);
      await clearModuleDtcs((cmd) => session.send(cmd));
    } finally {
      await session.resetAddressing();
    }
  });
  // The re-scan takes the lock itself, after the clear's block has released it.
  return scanModule(session, module);
}
