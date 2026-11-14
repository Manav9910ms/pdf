"use client";

import { PDFDocument } from "pdf-lib";

type OfficeKind = "word" | "powerpoint" | "excel";

async function addCanvasPage(pdf: PDFDocument, canvas: HTMLCanvasElement, width = 842) {
  const context = canvas.getContext("2d");
  if (!context || canvas.width < 1 || canvas.height < 1) throw new Error("This Office page could not be rendered.");
  const image = await pdf.embedJpg(canvas.toDataURL("image/jpeg", 0.94));
  const height = width * (canvas.height / canvas.width);
  const page = pdf.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
}

function makeHiddenHost(width: string) {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", left: "-30000px", top: "0", width, background: "#ffffff", color: "#111111", zIndex: "-1", overflow: "visible" });
  document.body.appendChild(host);
  return host;
}

async function wordToPdf(file: File) {
  const { renderAsync } = await import("docx-preview");
  const pdf = await PDFDocument.create();
  const host = makeHiddenHost("900px");
  try {
    await renderAsync(await file.arrayBuffer(), host, host, { className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false });
    await document.fonts.ready;
    const pages = Array.from(host.querySelectorAll<HTMLElement>(".docx"));
    if (!pages.length) throw new Error("No Word pages were found. Try saving the document again as .docx.");
    const html2canvas = (await import("html2canvas")).default;
    for (const page of pages) {
      const canvas = await html2canvas(page, { scale: 1.5, backgroundColor: "#ffffff", useCORS: true, logging: false });
      await addCanvasPage(pdf, canvas);
      canvas.width = 1; canvas.height = 1;
    }
  } finally { host.remove(); }
  return pdf.save();
}

async function powerpointToPdf(file: File) {
  const { PptxRenderer } = await import("pptx-browser");
  const renderer = new PptxRenderer();
  const pdf = await PDFDocument.create();
  try {
    await renderer.load(file);
    if (!renderer.slideCount) throw new Error("This PowerPoint file contains no slides.");
    for (let index = 0; index < renderer.slideCount; index++) {
      const canvas = document.createElement("canvas");
      await renderer.renderSlide(index, canvas, 1600);
      await addCanvasPage(pdf, canvas);
      canvas.width = 1; canvas.height = 1;
    }
  } finally { renderer.destroy(); }
  return pdf.save();
}

async function excelToPdf(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellStyles: true, cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("This Excel workbook contains no worksheets.");
  const pdf = await PDFDocument.create();
  const html2canvas = (await import("html2canvas")).default;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue;
    const host = makeHiddenHost("1200px");
    const heading = document.createElement("h2");
    heading.textContent = sheetName;
    heading.style.cssText = "font: bold 22px Arial; margin: 0 0 16px; color: #111;";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = XLSX.utils.sheet_to_html(sheet, { editable: false });
    wrapper.querySelectorAll("table").forEach((table) => {
      (table as HTMLElement).style.cssText = "border-collapse:collapse;width:100%;font:12px Arial;color:#111;";
    });
    wrapper.querySelectorAll("td,th").forEach((cell) => {
      (cell as HTMLElement).style.cssText += "border:1px solid #b9b9b9;padding:6px;min-width:48px;white-space:pre-wrap;";
    });
    host.style.padding = "24px";
    host.style.boxSizing = "border-box";
    host.append(heading, wrapper);
    try {
      const canvas = await html2canvas(host, { scale: 1.35, backgroundColor: "#ffffff", logging: false, windowWidth: 1250 });
      const pageWidth = 842;
      const pixelsPerPage = Math.max(1, Math.floor(595 / (pageWidth / canvas.width)));
      for (let y = 0; y < canvas.height; y += pixelsPerPage) {
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = Math.min(pixelsPerPage, canvas.height - y);
        const context = slice.getContext("2d");
        if (!context) throw new Error("Could not prepare an Excel worksheet page.");
        context.drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
        await addCanvasPage(pdf, slice, pageWidth);
        slice.width = 1; slice.height = 1;
      }
      canvas.width = 1; canvas.height = 1;
    } finally { host.remove(); }
  }
  if (!pdf.getPageCount()) throw new Error("No printable worksheet data was found in this workbook.");
  return pdf.save();
}

export async function convertOfficeToPdf(file: File, kind: OfficeKind): Promise<Uint8Array> {
  if (kind === "word") return wordToPdf(file);
  if (kind === "powerpoint") return powerpointToPdf(file);
  return excelToPdf(file);
}
