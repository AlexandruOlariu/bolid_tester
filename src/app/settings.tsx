import React from 'react';
import { SettingsScreen } from '@/features/settings';
import { resetAllAppData } from '@/features/backup';

/** The route composes Settings with the backup slice's **Reset all app data** (plan 07): no feature
 *  imports the backup slice, so the app layer hands Settings the one action it needs. */
export default function SettingsRoute() {
  return <SettingsScreen resetAppData={resetAllAppData} />;
}
