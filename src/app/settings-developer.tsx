import React from 'react';
import { DeveloperSettingsScreen } from '@/features/settings';
import { resetAllAppData } from '@/features/backup';

/** The route composes Settings → Developer & simulator with the backup slice's **Reset all app
 *  data** (plan 07): no feature imports the backup slice, so the app layer hands the page the one
 *  action it needs. */
export default function SettingsDeveloperRoute() {
  return <DeveloperSettingsScreen resetAppData={resetAllAppData} />;
}
