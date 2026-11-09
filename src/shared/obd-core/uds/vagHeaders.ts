/** Candidate 11-bit CAN tester → module / module → tester id pairs for VAG UDS modules, by VCDS
 *  diagnostic address (plan 25). Module address discovery probes each pair with `22 F187` so the
 *  real module map of a car is one tap away instead of guessed. NONE of these is confirmed on the
 *  reference Golf except the ISO 15765-4 engine pair: a pair that answers is evidence, a silent one
 *  is not proof the module is absent (it may sit behind TP2.0 on a PQ35/PQ46 car). */

export interface UdsHeaderCandidate {
  /** VCDS diagnostic address, e.g. '01' engine, '17' instruments. */
  address: string;
  name: string;
  /** Tester → module CAN id (ATSH). */
  reqHeader: string;
  /** Module → tester CAN id (ATCRA). */
  rxFilter: string;
  /** Lower-case words that, found in the module's ident (system name / any ident string), mark it
   *  as THIS candidate — used only to tell candidates that share one id pair apart. */
  identHints?: string[];
}

/** Known 11-bit CAN tester/response id pairs for VAG PQ35/PQ46-era UDS modules, by diagnostic
 *  address. Sources per entry: "ISO" = ISO 15765-4 legislated OBD pair; "profile" = the Golf
 *  profile's illustrative addressing (docs/vehicles/golf-plus-2009-20tdi.md); "community" =
 *  published VAG UDS id tables (unconfirmed for this platform). Radio (56) is omitted — it is TP2.0
 *  on the Golf; 2B (steering column lock) and 37 (navigation) have no well-known UDS pair. */
export const VAG_UDS_HEADER_CANDIDATES: UdsHeaderCandidate[] = [
  { address: '01', name: 'Engine', reqHeader: '7E0', rxFilter: '7E8' }, // ISO
  { address: '02', name: 'Auto transmission', reqHeader: '7E1', rxFilter: '7E9' }, // ISO
  { address: '03', name: 'ABS brakes', reqHeader: '760', rxFilter: '768' }, // profile
  // 08 and 46 share 746/7B0 on some cars: the pair is probed once and the ident's system name
  // picks the address (`pickCandidateByIdent`); the user can still switch between the two.
  {
    address: '08',
    name: 'Auto HVAC',
    reqHeader: '746',
    rxFilter: '7B0',
    identHints: ['climat', 'klima', 'hvac', 'air cond', 'heizung'],
  }, // community
  { address: '09', name: 'Central electrics', reqHeader: '70E', rxFilter: '778' }, // community
  { address: '10', name: 'Park / steer assist', reqHeader: '7D0', rxFilter: '7DA' }, // community
  { address: '15', name: 'Airbag', reqHeader: '715', rxFilter: '77F' }, // community
  { address: '16', name: 'Steering wheel', reqHeader: '70C', rxFilter: '776' }, // community
  { address: '17', name: 'Instruments', reqHeader: '714', rxFilter: '77E' }, // profile + community
  { address: '19', name: 'CAN gateway', reqHeader: '710', rxFilter: '77A' }, // community
  { address: '25', name: 'Immobilizer', reqHeader: '711', rxFilter: '77B' }, // community
  { address: '42', name: 'Door electronics driver', reqHeader: '74A', rxFilter: '7B4' }, // community
  { address: '44', name: 'Steering assist', reqHeader: '712', rxFilter: '77C' }, // community
  {
    address: '46',
    name: 'Central conv. (comfort)',
    reqHeader: '746',
    rxFilter: '7B0',
    identHints: ['komfort', 'comfort', 'convenience', 'zentral', 'central conv'],
  }, // community
  { address: '52', name: 'Door electronics passenger', reqHeader: '74C', rxFilter: '7B6' }, // community
];

/** A profile module, structurally (obd-core does not import the vehicle types). */
interface DeclaredModule {
  address: string;
  name: string;
  transport: string;
  reqHeader?: string;
  rxFilter?: string;
}

/** The discovery list for one car: the known candidates, plus any UDS pair the profile declares
 *  that is not already among them (so a car's own addressing is always probed too). Order: the
 *  known list first, then the profile's extras. */
export function discoveryCandidates(declared: DeclaredModule[] = []): UdsHeaderCandidate[] {
  const out = VAG_UDS_HEADER_CANDIDATES.slice();
  const key = (req: string, rx: string) => `${req.toUpperCase()}/${rx.toUpperCase()}`;
  const seen = new Set(out.map((c) => key(c.reqHeader, c.rxFilter)));
  for (const m of declared) {
    if (m.transport !== 'uds' || !m.reqHeader || !m.rxFilter) continue;
    const k = key(m.reqHeader, m.rxFilter);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ address: m.address, name: m.name, reqHeader: m.reqHeader, rxFilter: m.rxFilter });
  }
  return out;
}

/** `REQ/RX` upper-cased — the identity of a physical module on the bus. */
export function candidatePairKey(c: { reqHeader: string; rxFilter: string }): string {
  return `${c.reqHeader.toUpperCase()}/${c.rxFilter.toUpperCase()}`;
}

/** Group candidates by id pair, keeping first-seen order: one group per physical probe. */
export function groupCandidatesByPair(candidates: UdsHeaderCandidate[]): UdsHeaderCandidate[][] {
  const groups = new Map<string, UdsHeaderCandidate[]>();
  for (const c of candidates) {
    const k = candidatePairKey(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.values()];
}

/** For candidates that share one id pair: the one whose `identHints` appear in the module's ident
 *  (system name first, then every raw ident string). No ident, no hint match, or a tie → the first
 *  candidate (the caller still offers the others). */
export function pickCandidateByIdent(
  group: UdsHeaderCandidate[],
  ident: { systemName?: string; raw?: Record<string, string> } | null,
): UdsHeaderCandidate {
  if (group.length < 2 || !ident) return group[0];
  const texts = [ident.systemName ?? '', ...Object.values(ident.raw ?? {})].map((t) =>
    t.toLowerCase(),
  );
  const matches = group.filter((c) =>
    (c.identHints ?? []).some((h) => texts.some((t) => t.includes(h))),
  );
  return matches.length === 1 ? matches[0] : group[0];
}
