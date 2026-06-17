/** @deprecated Use `logError` from '@/shared/state/errorLogStore' — the app's single logging zone
 *  (the error-log feature). This module is kept only as a thin re-export so any lingering import
 *  keeps compiling; new code should import from errorLogStore directly. */
export { logError } from './errorLogStore';
