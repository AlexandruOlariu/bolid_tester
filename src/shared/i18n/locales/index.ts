/** The bundled translation resources (plan 11, docs/i18n.md): one JSON file per namespace and
 *  language, imported statically so Metro bundles them. Every file under `en/` and `ro/` must be
 *  listed here; `i18nParity.test.ts` fails when one is missing, and checks that each language has
 *  every key. Namespaces: `common` (tab titles, shared components, common actions) plus one per
 *  feature slice (camelCase of the `src/features/<slug>` folder). */
import type { LocaleBundle } from '@/shared/lib/i18nParity';
import en_adaptations from './en/adaptations.json';
import en_adapterHealth from './en/adapterHealth.json';
import en_aiDiagnose from './en/aiDiagnose.json';
import en_alerts from './en/alerts.json';
import en_backup from './en/backup.json';
import en_batteryHealth from './en/batteryHealth.json';
import en_canSniffer from './en/canSniffer.json';
import en_coding from './en/coding.json';
import en_common from './en/common.json';
import en_connection from './en/connection.json';
import en_dpf from './en/dpf.json';
import en_engineHost from './en/engineHost.json';
import en_errorLog from './en/errorLog.json';
import en_extendedPids from './en/extendedPids.json';
import en_faultCodes from './en/faultCodes.json';
import en_feedback from './en/feedback.json';
import en_history from './en/history.json';
import en_inspection from './en/inspection.json';
import en_liveCharts from './en/liveCharts.json';
import en_liveData from './en/liveData.json';
import en_maintenance from './en/maintenance.json';
import en_moduleScan from './en/moduleScan.json';
import en_more from './en/more.json';
import en_notifications from './en/notifications.json';
import en_onboarding from './en/onboarding.json';
import en_performanceTests from './en/performanceTests.json';
import en_report from './en/report.json';
import en_routines from './en/routines.json';
import en_sensorTests from './en/sensorTests.json';
import en_serviceReset from './en/serviceReset.json';
import en_settings from './en/settings.json';
import en_tripRecording from './en/tripRecording.json';
import en_vehicleInfo from './en/vehicleInfo.json';
import en_vehicleSelect from './en/vehicleSelect.json';
import en_vinDecode from './en/vinDecode.json';
import ro_adaptations from './ro/adaptations.json';
import ro_adapterHealth from './ro/adapterHealth.json';
import ro_aiDiagnose from './ro/aiDiagnose.json';
import ro_alerts from './ro/alerts.json';
import ro_backup from './ro/backup.json';
import ro_batteryHealth from './ro/batteryHealth.json';
import ro_canSniffer from './ro/canSniffer.json';
import ro_coding from './ro/coding.json';
import ro_common from './ro/common.json';
import ro_connection from './ro/connection.json';
import ro_dpf from './ro/dpf.json';
import ro_engineHost from './ro/engineHost.json';
import ro_errorLog from './ro/errorLog.json';
import ro_extendedPids from './ro/extendedPids.json';
import ro_faultCodes from './ro/faultCodes.json';
import ro_feedback from './ro/feedback.json';
import ro_history from './ro/history.json';
import ro_inspection from './ro/inspection.json';
import ro_liveCharts from './ro/liveCharts.json';
import ro_liveData from './ro/liveData.json';
import ro_maintenance from './ro/maintenance.json';
import ro_moduleScan from './ro/moduleScan.json';
import ro_more from './ro/more.json';
import ro_notifications from './ro/notifications.json';
import ro_onboarding from './ro/onboarding.json';
import ro_performanceTests from './ro/performanceTests.json';
import ro_report from './ro/report.json';
import ro_routines from './ro/routines.json';
import ro_sensorTests from './ro/sensorTests.json';
import ro_serviceReset from './ro/serviceReset.json';
import ro_settings from './ro/settings.json';
import ro_tripRecording from './ro/tripRecording.json';
import ro_vehicleInfo from './ro/vehicleInfo.json';
import ro_vehicleSelect from './ro/vehicleSelect.json';
import ro_vinDecode from './ro/vinDecode.json';

export const NAMESPACES = [
  'adaptations',
  'adapterHealth',
  'aiDiagnose',
  'alerts',
  'backup',
  'batteryHealth',
  'canSniffer',
  'coding',
  'common',
  'connection',
  'dpf',
  'engineHost',
  'errorLog',
  'extendedPids',
  'faultCodes',
  'feedback',
  'history',
  'inspection',
  'liveCharts',
  'liveData',
  'maintenance',
  'moduleScan',
  'more',
  'notifications',
  'onboarding',
  'performanceTests',
  'report',
  'routines',
  'sensorTests',
  'serviceReset',
  'settings',
  'tripRecording',
  'vehicleInfo',
  'vehicleSelect',
  'vinDecode',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const resources: Record<string, LocaleBundle> = {
  en: {
    adaptations: en_adaptations,
    adapterHealth: en_adapterHealth,
    aiDiagnose: en_aiDiagnose,
    alerts: en_alerts,
    backup: en_backup,
    batteryHealth: en_batteryHealth,
    canSniffer: en_canSniffer,
    coding: en_coding,
    common: en_common,
    connection: en_connection,
    dpf: en_dpf,
    engineHost: en_engineHost,
    errorLog: en_errorLog,
    extendedPids: en_extendedPids,
    faultCodes: en_faultCodes,
    feedback: en_feedback,
    history: en_history,
    inspection: en_inspection,
    liveCharts: en_liveCharts,
    liveData: en_liveData,
    maintenance: en_maintenance,
    moduleScan: en_moduleScan,
    more: en_more,
    notifications: en_notifications,
    onboarding: en_onboarding,
    performanceTests: en_performanceTests,
    report: en_report,
    routines: en_routines,
    sensorTests: en_sensorTests,
    serviceReset: en_serviceReset,
    settings: en_settings,
    tripRecording: en_tripRecording,
    vehicleInfo: en_vehicleInfo,
    vehicleSelect: en_vehicleSelect,
    vinDecode: en_vinDecode,
  },
  ro: {
    adaptations: ro_adaptations,
    adapterHealth: ro_adapterHealth,
    aiDiagnose: ro_aiDiagnose,
    alerts: ro_alerts,
    backup: ro_backup,
    batteryHealth: ro_batteryHealth,
    canSniffer: ro_canSniffer,
    coding: ro_coding,
    common: ro_common,
    connection: ro_connection,
    dpf: ro_dpf,
    engineHost: ro_engineHost,
    errorLog: ro_errorLog,
    extendedPids: ro_extendedPids,
    faultCodes: ro_faultCodes,
    feedback: ro_feedback,
    history: ro_history,
    inspection: ro_inspection,
    liveCharts: ro_liveCharts,
    liveData: ro_liveData,
    maintenance: ro_maintenance,
    moduleScan: ro_moduleScan,
    more: ro_more,
    notifications: ro_notifications,
    onboarding: ro_onboarding,
    performanceTests: ro_performanceTests,
    report: ro_report,
    routines: ro_routines,
    sensorTests: ro_sensorTests,
    serviceReset: ro_serviceReset,
    settings: ro_settings,
    tripRecording: ro_tripRecording,
    vehicleInfo: ro_vehicleInfo,
    vehicleSelect: ro_vehicleSelect,
    vinDecode: ro_vinDecode,
  },
};
