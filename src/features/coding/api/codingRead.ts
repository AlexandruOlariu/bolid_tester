/** The AI agent's read of one codeable module's coding (plan 34b): the module addressed through
 *  the read-only facade's `withModule`, one UDS `22 <codingDid>` read, decoded with the module's
 *  schema merged with any label-pack coding-bit names (the same `mergeCodingLabels` /
 *  `codingBitLabels` source `useCoding.fieldsFor` uses). Read only: no session change, no
 *  SecurityAccess, no write. See docs/features/coding.md. */

import {
  UdsError,
  bytesToHexString,
  decodeSchema,
  mergeCodingLabels,
  readDataByIdentifier,
} from '@/shared/obd-core';
import type { CodingField, ReadOnlySession } from '@/shared/obd-core';
import { codingBitLabels } from '@/shared/labels';
import type { LabelPack } from '@/shared/labels';
import type { CodingModule } from '@/shared/vehicles';

/** The label-pack lookup by part number: `findLabelPack`, or `useLabelPackFinder()` in a screen. */
export type LabelPackLookup = (partNumber: string | undefined | null) => LabelPack | null;

export interface CodingReadOut {
  /** The coding bytes as spaced upper-case hex, e.g. `"01 00 10 00"`. */
  hex: string;
  /** Every named field: a single bit reads `on` / `off`, a mask or whole byte its decimal value. */
  fields: { name: string; value: string }[];
}

/** The module's fields: its own schema merged additively with the label pack's coding-bit names. */
export function codingFieldsFor(m: CodingModule, labels: LabelPackLookup): CodingField[] {
  return mergeCodingLabels(m.schema, codingBitLabels(labels(m.partNumber), m.codingDid));
}

/** Read and decode `m`'s coding, or null when the module gives no (positive) answer. A link error
 *  throws, and so does an excluded module (`ModuleNotAllowedError`). */
export async function readCodingReadOnly(
  ro: ReadOnlySession,
  m: CodingModule,
  labels: LabelPackLookup,
): Promise<CodingReadOut | null> {
  let bytes: number[];
  try {
    bytes = await ro.withModule(
      { reqHeader: m.reqHeader, rxFilter: m.rxFilter || undefined },
      (send) => readDataByIdentifier(send, m.codingDid),
    );
  } catch (e) {
    if (e instanceof UdsError) return null;
    throw e;
  }
  if (bytes.length === 0) return null;
  const fields = codingFieldsFor(m, labels);
  return {
    hex: bytesToHexString(bytes),
    fields: decodeSchema(bytes, fields).map((d, i) => ({
      name: d.name,
      value: fields[i].bit !== undefined ? (d.value ? 'on' : 'off') : String(d.value),
    })),
  };
}
