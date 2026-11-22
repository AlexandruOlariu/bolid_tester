/** Compatibility re-export: the VAG native KWP 5-digit fault texts moved into the DTC database
 *  (`obd/dtcDatabase/manufacturer/vag.ts`, plan 05). They describe KWP `0x18` faults from TP2.0
 *  modules only; SAE-encoded P/C/B/U codes (OBD2, UDS) are described by `lookupDtc` /
 *  `describeDtc` in `obd/dtcDatabase`. */
export { VAG_DTC_TEXTS, vagDtcText, vagNativeDtcText } from '../obd/dtcDatabase/manufacturer/vag';
