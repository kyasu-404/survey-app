// Shared by the in-app preview and the standalone download. Every layout rule
// is confined to the report; the named page does not change other app printing.
export const RESPONSES_HTML_LAYOUT_CSS = `
.responses-html-report { min-width: 0; max-width: 100%; }
.responses-html-report .responses-report-screen { min-width: 0; max-width: 100%; }
.responses-html-report .responses-report-print { display: none; }
.responses-html-report .responses-report-screen table { width: max-content; min-width: 100%; }
.responses-html-report .responses-report-screen th,
.responses-html-report .responses-report-screen td { min-width: 180px; max-width: 360px; }
.responses-html-report .responses-report-screen .responses-table-date-column { min-width: 12ch; width: 12ch; }
.responses-html-report .response-signature-image {
  display: block; width: 180px; height: 90px; max-width: 100%; object-fit: contain;
  object-position: left center; background: #fff; border: 1px solid #cbd5e1; border-radius: 4px;
}
@page responses-report { size: A4 landscape; margin: 10mm; }
@media print {
  :root:has(.responses-html-report) { background: #fff; color-scheme: light; }
  body:has(.responses-html-report) { background: #fff; }
  .app-shell:has(.responses-html-report), .app-main:has(.responses-html-report) {
    display: block; margin: 0; padding: 0; min-height: 0; background: #fff;
  }
  .responses-html-report { page: responses-report; width: 100%; margin: 0; padding: 0; border: 0; box-shadow: none; }
  .responses-html-report .responses-report-screen { display: none; }
  .responses-html-report .responses-report-print { display: block; }
  .responses-html-report .report-header { break-inside: avoid; margin-bottom: 5mm; gap: 3mm; }
  .responses-html-report .report-meta { display: flex; gap: 5mm; }
  .responses-html-report .report-meta div { padding: 2mm; }
  .responses-html-report .responses-print-block + .responses-print-block { break-before: page; }
  .responses-html-report .responses-print-block h2 { margin: 0 0 3mm; font-size: 12px; break-after: avoid; }
  .responses-html-report .responses-print-block .responses-table-wrap { overflow: visible; border: 0; border-radius: 0; }
  .responses-html-report .responses-print-block table { width: 100%; min-width: 0; table-layout: fixed; border-collapse: collapse; }
  .responses-html-report .responses-print-block thead { display: table-header-group; }
  .responses-html-report .responses-print-block tr { break-inside: avoid; }
  .responses-html-report .responses-print-block th,
  .responses-html-report .responses-print-block td {
    width: auto; min-width: 0; max-width: none; padding: 1.5mm; border: 1px solid #94a3b8;
    font-size: 9pt; line-height: 1.3; text-transform: none; color: #111827; background: #fff;
    white-space: pre-wrap; overflow-wrap: anywhere; vertical-align: top;
  }
  .responses-html-report .responses-print-block th { font-weight: 700; background: #f1f5f9; }
  .responses-html-report .responses-print-block .responses-table-date-column { width: 23mm; min-width: 0; white-space: normal; }
  .responses-html-report .responses-print-block .responses-table-date-cell { width: auto; min-width: 0; }
  .responses-html-report .responses-print-block .responses-table-date-line { white-space: nowrap; }
  .responses-html-report .responses-print-block .responses-print-page-heading { background: #dbeafe; color: #1e40af; }
  .responses-html-report .responses-print-block .responses-print-section-heading { background: #f1f5f9; font-weight: 800; }
  .responses-html-report .responses-print-block .response-signature-image { width: 100%; height: 16mm; border: 0; }
  .responses-html-report .responses-print-block { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;
