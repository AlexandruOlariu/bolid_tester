/** Shared building blocks for the self-contained HTML reports (`dtcReport.buildDtcReportHtml` and
 *  `vehicleReport.renderReportHtml`, plan 15): the inline stylesheet and the HTML escaper. Pure and
 *  dependency-free, so both renderers stay unit-testable in Node. */

/** Escape the five HTML-significant characters so decoder-supplied text can't break the markup. */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The print-friendly inline stylesheet every report uses (light scheme, no external assets). The
 *  text between `<style>` and `</style>`, byte-for-byte what the fault-code report always had. */
export const REPORT_CSS = `  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    margin: 0; padding: 24px; color: #1a1a1a; background: #fff; line-height: 1.4; }
  .wrap { max-width: 720px; margin: 0 auto; }
  header { border-bottom: 3px solid #2bb673; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 13px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 700;
    color: #fff; margin-left: 8px; vertical-align: middle; }
  .badge.on { background: #d9342b; } .badge.off { background: #2bb673; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 16px 0 8px; }
  .meta-row { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 4px 0; font-size: 13px; }
  .meta-k { color: #666; } .meta-v { font-weight: 600; text-align: right; }
  h2 { font-size: 15px; margin: 20px 0 6px; }
  .count { color: #888; font-weight: 400; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #666; font-weight: 600; border-bottom: 2px solid #ddd; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.code { font-weight: 700; color: #d9342b; font-family: ui-monospace, monospace; white-space: nowrap; }
  td.vag { font-family: ui-monospace, monospace; color: #444; white-space: nowrap; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.muted, .muted { color: #999; }
  footer { margin-top: 28px; color: #999; font-size: 11px; text-align: center; }
  @media print { body { padding: 0; } header { break-after: avoid; } section { break-inside: avoid; } }`;
