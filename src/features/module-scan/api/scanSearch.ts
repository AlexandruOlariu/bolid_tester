/** Pure "search all modules for a DTC" over a saved/last scan — the query VCDS users reach for when
 *  chasing one symptom across gateway / ABS / cluster / engine. Matches a fault by its VAG 5-digit
 *  number, its OBD2/SAE code (P0xxx, including the engine's OBD2 codes that appear in the scan), or a
 *  case-insensitive substring of its fault text. Returns each module that has ≥1 matching fault, with
 *  its dtcs narrowed to the matches. No I/O; unit-tested. See docs/features/module-scan.md. */

import type { SavedScanModule, SavedScanDtc } from '../model/scanHistoryStore';

export interface ScanSearchModuleHit {
  address: string;
  name: string;
  dtcs: SavedScanDtc[];
}

/** Normalize a query for matching: trimmed, upper-cased, spaces collapsed. */
function norm(q: string): string {
  return q.trim().toUpperCase().replace(/\s+/g, ' ');
}

function dtcMatches(d: SavedScanDtc, q: string): boolean {
  const qNoSpace = q.replace(/\s+/g, '');
  // VAG 5-digit number (exact or prefix), e.g. '08579' / '8579'.
  if (d.vagCode && (d.vagCode === q || d.vagCode === qNoSpace || d.vagCode.replace(/^0+/, '') === qNoSpace.replace(/^0+/, '')))
    return true;
  // SAE / OBD2 code, e.g. 'P2183' (with or without the failure-type suffix).
  if (d.sae.toUpperCase() === qNoSpace) return true;
  if (d.display.toUpperCase().replace(/\s+/g, '') === qNoSpace) return true;
  if (d.sae.toUpperCase().startsWith(qNoSpace) && /^[PCBU]/.test(qNoSpace)) return true;
  // Fault-text substring.
  if (d.description.toUpperCase().includes(q)) return true;
  return false;
}

/** Filter a scan's modules to those with a fault matching `query`, each carrying only the matched
 *  faults. An empty / whitespace query returns []. */
export function searchScan(modules: SavedScanModule[], query: string): ScanSearchModuleHit[] {
  const q = norm(query);
  if (!q) return [];
  const hits: ScanSearchModuleHit[] = [];
  for (const m of modules) {
    const dtcs = m.dtcs.filter((d) => dtcMatches(d, q));
    if (dtcs.length) hits.push({ address: m.address, name: m.name, dtcs });
  }
  return hits;
}
