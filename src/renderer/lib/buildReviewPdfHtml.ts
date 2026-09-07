export function buildReviewPdfHtml(flowName: string, flowSvg: string, screens: { name: string; svg: string }[]): string {
  const screenSections = screens
    .map(
      (s) => `
        <div style="margin-top:36px; page-break-inside: avoid;">
          <h2 style="font-size:15px; color:#8f80ff; margin:0 0 12px 0; font-family: Inter, system-ui, sans-serif;">${escapeHtml(s.name)}</h2>
          ${s.svg}
        </div>`,
    )
    .join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { background:#0a0a0c; color:#fff; font-family: Inter, system-ui, sans-serif; margin:0; padding:40px; }
  h1 { font-size:22px; margin:0 0 6px 0; }
  .subtitle { font-size:12px; color:rgba(255,255,255,0.45); margin-bottom:24px; }
  svg { max-width:100%; height:auto; border-radius:8px; }
</style>
</head>
<body>
  <h1>${escapeHtml(flowName)}</h1>
  <div class="subtitle">FrameUI review export</div>
  ${flowSvg}
  ${screenSections}
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
