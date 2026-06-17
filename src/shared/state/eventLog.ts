/** Thin helper so any feature can drop a line into the shared event log (Settings → Event log)
 *  without wiring the store into a component. Use for anything that might have an issue: the start
 *  and outcome of fault reads/clears, service resets, coding writes, etc. */
import { useSettingsStore } from './settingsStore';

/** Log an informational feature event, e.g. logInfo('faults', 'read: 0 stored, 0 pending'). */
export function logInfo(tag: string, text: string): void {
  useSettingsStore.getState().appendEvent(text, { tag, level: 'info' });
}

/** Log a feature error/failure, e.g. logError('service-reset', 'No response from cluster'). */
export function logError(tag: string, text: string): void {
  useSettingsStore.getState().appendEvent(text, { tag, level: 'err' });
}
