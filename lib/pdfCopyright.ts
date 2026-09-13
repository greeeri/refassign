export const REPORT_COPYRIGHT = "© 2026 Ref Pro Group LLC";

export function addReportCopyright(document: any) {
  const pages = document.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    document.setPage(page);
    document.setFontSize(7);
    document.setTextColor(100, 116, 139);
    document.text(REPORT_COPYRIGHT, document.internal.pageSize.getWidth() / 2, document.internal.pageSize.getHeight() - 6, { align: "center" });
  }
}
