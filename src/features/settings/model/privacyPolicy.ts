/** The privacy policy shown in Settings → About. The same text is published as
 *  docs/privacy-policy.md (the copy that gets hosted for the stores); `privacyPolicy.test.ts` fails
 *  if a heading or paragraph here is missing from that file, so change both together. */

export interface PolicySection {
  heading: string;
  paragraphs: string[];
}

/** Date of the current wording (YYYY-MM-DD). Bump it with any change to the text. */
export const PRIVACY_POLICY_UPDATED = '2026-11-09';

export const PRIVACY_POLICY: PolicySection[] = [
  {
    heading: 'What stays on your phone',
    paragraphs: [
      'Everything the app reads from your car — fault codes, live data, the VIN, scans, trips and their GPS points, maintenance entries, backups, bus captures and the error log — is stored only on this phone, in the app’s private storage.',
      'There are no accounts, no analytics, no advertising and no tracking. The developer receives nothing from the app.',
    ],
  },
  {
    heading: 'When the app uses the internet',
    paragraphs: [
      'AI assistant: off until you set up a provider. When you pick one (your own local server, OpenAI, Anthropic or another server you enter), each diagnosis and each follow-up question sends that provider a summary of the scan: fault codes, readiness monitors, the freeze frame, a few live values, the vehicle make, model and engine, the VIN and the car’s known checks for those codes, plus your question and the earlier answers. It goes only to the provider you chose. A local server stays on your network; a cloud provider (OpenAI or Anthropic) receives it over the internet and handles it under its own privacy policy and terms. API keys are kept in the phone’s secure storage, one per provider, never in backups, and each is sent only to its own provider.',
      'App updates: when you tap More → Check for updates, the app asks the Expo update server (run by Expo, expo.dev) whether a newer version exists and downloads it only if you accept. The request carries the app version, the update channel, the platform and a random installation ID created by the update library; like any web request, the server also sees your IP address. The app does not check on its own at launch; the only automatic check happens when the app restarts after crashing during start-up, to recover with a working version.',
      'Web search: on a fault code’s detail sheet, Search the web opens your browser with a search for that code and, when a car is selected, its name. From there the browser and the search engine apply their own privacy policies.',
    ],
  },
  {
    heading: 'Bluetooth, location and notifications',
    paragraphs: [
      'Bluetooth is used only to find and talk to your OBD2 adapter. The Bluetooth scan is declared as not used to work out your location.',
      'Location is used only while you record a trip with GPS (and, on older Android versions, because the system requires it for Bluetooth scanning). The GPS track is stored on the phone only.',
      'Notifications are reminders and alerts created on the phone. There is no push server.',
    ],
  },
  {
    heading: 'Sharing and exports',
    paragraphs: [
      'Files leave the phone only when you share or export them yourself — a report, a capture, a fixture, a backup or the error log — and they go to the app you pick in the share sheet.',
      'A backup (Settings → Data → Backup & restore) is one plain-text file that you create and keep where you choose. It holds everything listed above, including your VINs, and is not encrypted, so keep it somewhere private. It never contains an AI API key.',
    ],
  },
  {
    heading: 'Deleting your data',
    paragraphs: [
      'History, trips and the error log have their own delete or clear buttons.',
      'To erase everything, uninstall the app, or open Android Settings → Apps → Bolid Tester → Storage and tap Clear storage.',
    ],
  },
  {
    heading: 'Changes and questions',
    paragraphs: [
      'Changes to this policy ship with app updates and are noted in the release notes; the date above shows the current wording. Questions: open an issue on the project page, github.com/AlexandruOlariu/bolid_tester.',
    ],
  },
];
