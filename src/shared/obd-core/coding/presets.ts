/** One-tap coding presets ("tweaks", OBDeleven-style): a curated per-profile toggle compiled down
 *  to the existing gated coding write (backup → write → verify in udsCoding). A preset is DATA on
 *  the vehicle profile; these pure helpers apply it to / detect it in a coding byte array. No device
 *  I/O — the write itself goes through the same guarded path as manual coding. See
 *  docs/features/coding.md (tweaks). */

import { setByte } from './coding';
import type { Confirmation } from '../confirmation';

/** One field edit inside a preset. `onValue`/`offValue` are the target bits **in place** within the
 *  byte (masked), so a bit uses mask `1<<bit` with on=that bit set, and a nibble uses e.g. mask
 *  0x0F with on=0x03. Keeping them pre-shifted makes apply/detect a plain masked compare — no
 *  shift-direction ambiguity. */
export interface CodingPresetEdit {
  byte: number;
  /** Single bit 0–7 (implies mask `1<<bit`). Omit for a masked/whole-byte field. */
  bit?: number;
  /** Mask within the byte for a multi-bit field. Defaults to `1<<bit` for a bit, else 0xFF. */
  mask?: number;
  /** Masked bits representing the ENABLED state. */
  onValue: number;
  /** Masked bits representing the DISABLED / factory state (used for revert + 'off' detection). */
  offValue: number;
}

export type CodingPresetState = 'on' | 'off' | 'unknown';

/** A curated, reversible coding tweak for one codeable module. `reqHeader` links it to a
 *  `CodingModule` in the same profile (matched on the ATSH request header). */
export interface CodingPreset {
  id: string;
  title: string;
  description: string;
  /** ATSH request header of the target CodingModule (e.g. '70E'). */
  reqHeader: string;
  edits: CodingPresetEdit[];
  /** Always true — presets ship only when the change can be reverted to `offValue`. */
  reversible: true;
  /** Evidence the bit positions were checked on the real car (plan 25), e.g. a before/after BCM
   *  coding read around a VCDS toggle explained by `compareCodingSnapshots`. */
  confirmed?: Confirmation;
}

function editMask(edit: CodingPresetEdit): number {
  return (edit.mask ?? (edit.bit !== undefined ? 1 << edit.bit : 0xff)) & 0xff;
}

/** Set the byte's masked bits to `value` (masked defensively), immutably (pads out-of-range). */
function writeField(bytes: number[], byteIndex: number, mask: number, value: number): number[] {
  const cur = bytes[byteIndex] ?? 0;
  const next = (cur & ~mask) | (value & mask);
  return setByte(bytes, byteIndex, next);
}

/** Apply a preset's ENABLED state to a coding value, immutably. */
export function applyPreset(bytes: number[], preset: CodingPreset): number[] {
  let out = bytes.slice();
  for (const edit of preset.edits) out = writeField(out, edit.byte, editMask(edit), edit.onValue);
  return out;
}

/** Revert a preset to its DISABLED / factory state, immutably. */
export function revertPreset(bytes: number[], preset: CodingPreset): number[] {
  let out = bytes.slice();
  for (const edit of preset.edits) out = writeField(out, edit.byte, editMask(edit), edit.offValue);
  return out;
}

/** Current state of a preset within a coding value: 'on' only when EVERY edit matches its `onValue`,
 *  'off' only when every edit matches its `offValue`, else 'unknown' (partially applied / foreign
 *  value). Drives the Tweaks list's on/off/unknown badge. */
export function detectPresetState(bytes: number[], preset: CodingPreset): CodingPresetState {
  let allOn = true;
  let allOff = true;
  for (const edit of preset.edits) {
    const mask = editMask(edit);
    const field = (bytes[edit.byte] ?? 0) & mask;
    if (field !== (edit.onValue & mask)) allOn = false;
    if (field !== (edit.offValue & mask)) allOff = false;
  }
  if (allOn) return 'on';
  if (allOff) return 'off';
  return 'unknown';
}

export type SnapshotMatch = 'on' | 'off' | 'none';

/** Which shipped preset explains the difference between two coding reads taken around a VCDS
 *  toggle (plan 25 — the tool for confirming tweak bit positions from the owner's own before /
 *  after reads). A preset matches only when (1) something changed, (2) EVERY changed bit lies
 *  inside the preset's edit masks, (3) at least one of its fields changed, and (4) the after-read
 *  is fully that preset's `on` (→ 'on') or `off` (→ 'off') state. Anything else is 'none' — a bit
 *  outside the preset's fields means its positions are wrong (or the toggle did more), which is
 *  exactly what a confirmation must catch. */
export function compareCodingSnapshots(
  before: number[],
  after: number[],
  presets: CodingPreset[],
): { presetId: string; matches: SnapshotMatch }[] {
  const len = Math.max(before.length, after.length);
  const diff: number[] = [];
  for (let i = 0; i < len; i++) diff.push(((before[i] ?? 0) ^ (after[i] ?? 0)) & 0xff);
  const changed = diff.some((d) => d !== 0);
  return presets.map((preset) => {
    const masks: number[] = new Array(len).fill(0);
    for (const edit of preset.edits) {
      if (edit.byte < len) masks[edit.byte] |= editMask(edit);
    }
    const covered = diff.every((d, i) => (d & ~masks[i] & 0xff) === 0);
    const touched = diff.some((d, i) => (d & masks[i]) !== 0);
    if (!changed || !covered || !touched) return { presetId: preset.id, matches: 'none' };
    const state = detectPresetState(after, preset);
    return { presetId: preset.id, matches: state === 'unknown' ? 'none' : state };
  });
}
