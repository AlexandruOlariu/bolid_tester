/** The privacy policy shown in Settings → About. The same text is published as
 *  docs/privacy-policy.md (the copy that gets hosted for the stores); `privacyPolicy.test.ts` fails
 *  if a heading or paragraph here is missing from that file, so change both together. */

export interface PolicySection {
  heading: string;
  paragraphs: string[];
}

/** Date of the current wording (YYYY-MM-DD). Bump it with any change to the text. */
export const PRIVACY_POLICY_UPDATED = '2026-11-23';

export const PRIVACY_POLICY: PolicySection[] = [
  {
    heading: 'What stays on your phone',
    paragraphs: [
      'Everything the app reads from your car — fault codes, live data, the VIN, scans, trips and their GPS points, maintenance entries, backups, bus captures and the error log — is stored only on this phone, in the app’s private storage.',
      'There are no accounts, no analytics, no advertising and no tracking. The developer receives nothing from the app unless you turn on crash reports (below).',
    ],
  },
  {
    heading: 'When the app uses the internet',
    paragraphs: [
      'AI assistant: off until you set up a provider. When you pick one (your own local server, OpenAI, Anthropic or another server you enter), each diagnosis, each investigation step and each follow-up question sends that provider what the app has read for it: fault codes and their descriptions, readiness monitors, the freeze frame, live values and short recordings, the vehicle make, model and engine, the VIN, the car’s known checks for those codes and, when the investigation reads them, control-module part numbers, software versions and fault codes, manufacturer readings (extended data, adaptation and coding values, DPF values), recorded trip values, fuel-economy and performance-test results, the maintenance log, past diagnoses and fault-code checks from History, your alert rules, recent app error messages (with VINs and addresses removed), adapter details, and your answers to the on-screen driver steps, plus your question and the earlier answers. It goes only to the provider you chose. A local server stays on your network; a cloud provider (OpenAI or Anthropic) receives it over the internet and handles it under its own privacy policy and terms. API keys are kept in the phone’s secure storage, one per provider, never in backups, and each is sent only to its own provider.',
      'App updates: when you tap More → Check for updates, the app asks the Expo update server (run by Expo, expo.dev) whether a newer version exists and downloads it only if you accept. The request carries the app version, the update channel, the platform and a random installation ID created by the update library; like any web request, the server also sees your IP address. The app does not check on its own at launch; the only automatic check happens when the app restarts after crashing during start-up, to recover with a working version.',
      'Web search: on a fault code’s detail sheet, Search the web opens your browser with a search for that code and, when a car is selected, its name. From there the browser and the search engine apply their own privacy policies.',
      'Rate this app: Settings → About → Rate this app opens the app’s page in Google Play or the App Store. The app sends nothing itself; the store applies its own privacy policy.',
    ],
  },
  {
    heading: 'Crash reports (optional)',
    paragraphs: [
      'Crash reports are off unless you turn on Settings → Privacy → Send anonymous crash reports. When on, a crash or an unexpected error sends a report to Sentry (Functional Software, Inc.), a crash-reporting service, stored in its EU region (Germany). A report contains the app version, the phone model and system version, the error message and where in the app it happened, the last screens opened and the connection status changes before it. Before a report of an error in the app’s own code leaves the phone, the app removes VINs, adapter names and addresses, server addresses, API keys, e-mail addresses and GPS coordinates. A crash inside the phone’s system code or a built-in library is reported by the crash-reporting library directly, without that clean-up: it holds the technical error details and could, rarely, include a Bluetooth adapter’s address. A report never contains trip data, live values or your location. No account or user ID is set; the crash-reporting library adds its own random installation ID to count crash-free sessions, and the service sees your IP address like any web request but is set not to store it.',
      'Reports are kept for 90 days and used only to find and fix bugs. The legal basis is your consent, which you withdraw by turning the switch off: nothing more is sent from then on. Reports already sent cannot be deleted from the phone, but they are not linked to you.',
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
      'Sharing a problem report: More → Report a problem builds one file with the error log, the adapter log, the app version, the phone’s system version, the selected car and the last module scan, plus anything you type. The VIN and the adapter’s address are removed unless you turn on Keep VIN and adapter address, and AI server addresses and keys are never included. Nothing is sent until you choose where it goes: the share sheet, an email draft, or Open GitHub issue, which opens your browser on a new public issue on the project page with a summary filled in (always without the VIN and the adapter address); you see it and submit it yourself.',
      'Send to Claude / ChatGPT: on an AI report, this builds a plain-text summary of the report, the fault codes and every check the investigation made, shows it to you first, and hands it to the app you pick in the share sheet, for example the official Claude or ChatGPT app. The VIN is left out unless you turn on Include VIN in that preview. The app sends nothing itself.',
      'A backup (Settings → Backup & restore) is one plain-text file that you create and keep where you choose. It holds everything listed above, including your VINs, and is not encrypted, so keep it somewhere private. It never contains an AI API key.',
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
