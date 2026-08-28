import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function amount(value) {
  return Number(value || 0);
}

function formatPdfEuro(value) {
  return `${amount(value).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

function safeFilePart(value) {
  return String(value || "mes")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function calculateMonth(month, irpfRate) {
  const rows = Array.isArray(month?.enriched) ? month.enriched : [];
  const totals = rows.reduce((summary, item) => ({
    base: summary.base + amount(item.payroll?.base),
    complement: summary.complement + amount(item.payroll?.complement),
    meal: summary.meal + amount(item.payroll?.continuousDoubleMeal),
    remate: summary.remate + amount(item.payroll?.remate),
    prima: summary.prima + amount(item.payroll?.prima),
    relay: summary.relay + amount(item.payroll?.relayHour),
    gross: summary.gross + amount(item.payroll?.total)
  }), { base: 0, complement: 0, meal: 0, remate: 0, prima: 0, relay: 0, gross: 0 });
  const withholding = totals.gross * (amount(irpfRate) / 100);
  return { rows, totals, withholding, net: totals.gross - withholding };
}

export function createMonthlyPayrollPdf(month, irpfRate = 0) {
  const { rows, totals, withholding, net } = calculateMonth(month, irpfRate);
  const document = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = document.internal.pageSize.getWidth();
  const title = String(month?.monthLabel || "Resumen mensual");

  document.setFillColor(8, 47, 91);
  document.rect(0, 0, pageWidth, 34, "F");
  document.setTextColor(255, 255, 255);
  document.setFont("helvetica", "bold");
  document.setFontSize(18);
  document.text("APP CPE - RESUMEN MENSUAL", 14, 15);
  document.setFontSize(12);
  document.text(title.toUpperCase(), 14, 24);

  const cards = [
    ["BRUTO", formatPdfEuro(totals.gross)],
    [`RETENCION (${amount(irpfRate).toLocaleString("es-ES")}%)`, `-${formatPdfEuro(withholding)}`],
    ["NETO ESTIMADO", formatPdfEuro(net)]
  ];
  cards.forEach(([label, value], index) => {
    const x = 14 + index * 61;
    document.setFillColor(index === 2 ? 232 : 244, index === 2 ? 250 : 247, index === 2 ? 245 : 250);
    document.roundedRect(x, 40, 56, 19, 2, 2, "F");
    document.setTextColor(91, 108, 126);
    document.setFontSize(7.5);
    document.setFont("helvetica", "bold");
    document.text(label, x + 4, 47);
    document.setTextColor(index === 2 ? 6 : 12, index === 2 ? 119 : 43, index === 2 ? 96 : 79);
    document.setFontSize(11);
    document.text(value, x + 4, 54);
  });

  document.setTextColor(12, 43, 79);
  document.setFontSize(8);
  document.text(
    `Jornales: ${rows.length}   Bases: ${formatPdfEuro(totals.base)}   Complementos: ${formatPdfEuro(totals.complement)}   Manut.: ${formatPdfEuro(totals.meal)}   Remates: ${formatPdfEuro(totals.remate)}   Primas: ${formatPdfEuro(totals.prima)}   Relevos: ${formatPdfEuro(totals.relay)}`,
    14,
    67
  );

  autoTable(document, {
    startY: 73,
    rowPageBreak: "avoid",
    margin: { left: 10, right: 10, bottom: 14 },
    head: [["Dia", "Jornada", "Especialidad", "Destino", "Base", "Compl.", "Manut.", "Remate", "Prima", "Total"]],
    body: rows.map((item) => [
      String(item.dia || "-"),
      String(item.payroll?.shift || "-"),
      String(item.especialidad || "Jornal"),
      [item.buque, item.empresa].filter((value) => value && !/^(?:--?|—)$/.test(String(value).trim())).join(" - ") || "-",
      formatPdfEuro(item.payroll?.base),
      formatPdfEuro(item.payroll?.complement),
      item.payroll?.continuousDoubleMeal > 0 ? formatPdfEuro(item.payroll.continuousDoubleMeal) : "-",
      item.payroll?.remate > 0 ? formatPdfEuro(item.payroll.remate) : "-",
      item.payroll?.operationType === "RECEPCION_ENTREGA"
        ? "-"
        : item.payroll?.prima > 0 ? formatPdfEuro(item.payroll.prima) : "Pendiente",
      formatPdfEuro(item.payroll?.total)
    ]),
    styles: { font: "helvetica", fontSize: 7, cellPadding: 2, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [8, 67, 112], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [244, 248, 251] },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 14, halign: "center" },
      2: { cellWidth: 21 },
      3: { cellWidth: 32 },
      4: { cellWidth: 16, halign: "right" },
      5: { cellWidth: 15, halign: "right" },
      6: { cellWidth: 15, halign: "right" },
      7: { cellWidth: 16, halign: "right" },
      8: { cellWidth: 16, halign: "right" },
      9: { cellWidth: 17, halign: "right", fontStyle: "bold" }
    },
    didDrawPage: () => {
      const pageNumber = document.internal.getNumberOfPages();
      const pageHeight = document.internal.pageSize.getHeight();
      document.setTextColor(110, 124, 139);
      document.setFontSize(7);
      document.text(`App CPE - ${title} - Pagina ${pageNumber}`, 14, pageHeight - 7);
    }
  });

  return document;
}

export function downloadMonthlyPayrollPdf(month, irpfRate = 0) {
  const document = createMonthlyPayrollPdf(month, irpfRate);
  document.save(`app-cpe-${safeFilePart(month?.monthLabel)}.pdf`);
}
