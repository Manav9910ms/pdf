"use client";

import { useMemo, useState } from "react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { Files, Scissors, RotateCw, ShieldCheck, Upload, X, ArrowDownToLine, FileText, Check, Image as ImageIcon, FileArchive, Stamp, Lock, Unlock, Images } from "lucide-react";
import JSZip from "jszip";

type Tool = "merge" | "split" | "rotate" | "images" | "compress" | "watermark" | "pdf-images" | "protect" | "unlock";
type PickedFile = { file: File; id: string };

const tools = [
  { id: "merge" as const, title: "Merge PDF", detail: "Combine files into one", icon: Files },
  { id: "split" as const, title: "Split PDF", detail: "Extract the pages you need", icon: Scissors },
  { id: "rotate" as const, title: "Rotate PDF", detail: "Fix page orientation", icon: RotateCw },
  { id: "images" as const, title: "Images to PDF", detail: "Turn images into a PDF", icon: ImageIcon },
  { id: "compress" as const, title: "Compress PDF", detail: "Reduce PDF file size", icon: FileArchive },
  { id: "watermark" as const, title: "Watermark PDF", detail: "Add text to every page", icon: Stamp },
  { id: "pdf-images" as const, title: "PDF to Images", detail: "Export pages as PNG or JPG", icon: Images },
  { id: "protect" as const, title: "Protect PDF", detail: "Encrypt with a password", icon: Lock },
  { id: "unlock" as const, title: "Unlock PDF", detail: "Remove a password you know", icon: Unlock },
];

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read image: ${file.name}`)); };
    image.src = url;
  });
}

export default function Home() {
  const [tool, setTool] = useState<Tool>("merge");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [pages, setPages] = useState("1");
  const [angle, setAngle] = useState(90);
  const [quality, setQuality] = useState("medium");
  const [watermark, setWatermark] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(0.22);
  const [watermarkSize, setWatermarkSize] = useState(44);
  const [watermarkAngle, setWatermarkAngle] = useState(-35);
  const [position, setPosition] = useState("center");
  const [imageFormat, setImageFormat] = useState("png");
  const [imageScale, setImageScale] = useState("1.5");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");
  const [resultSize, setResultSize] = useState(0);

  const acceptsMultiple = tool === "merge" || tool === "images";
  const isImageTool = tool === "images";
  const isPdfToImages = tool === "pdf-images";
  const currentTool = tools.find((item) => item.id === tool)!;
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const selected = Array.from(list);
    const valid = isImageTool
      ? selected.filter((file) => file.type.startsWith("image/"))
      : selected.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!valid.length) { setError(isImageTool ? "Choose supported image files." : "Please choose a PDF file."); return; }
    setError("");
    setDownloadUrl("");
    setFiles((old) => {
      const next = acceptsMultiple ? [...old.map((item) => item.file), ...valid] : [valid[0]];
      return next.map((file, index) => ({ file, id: `${file.name}-${file.lastModified}-${index}` }));
    });
  }

  function removeFile(id: string) {
    setFiles((old) => old.filter((item) => item.id !== id));
    setDownloadUrl("");
  }

  function moveFile(index: number, direction: number) {
    setFiles((old) => {
      const next = [...old];
      const target = index + direction;
      if (target < 0 || target >= next.length) return old;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function saveResult(bytes: Uint8Array, name: string) {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    setDownloadUrl(URL.createObjectURL(blob));
    setDownloadName(name);
    setResultSize(blob.size);
  }

  function saveBlob(blob: Blob, name: string) {
    setDownloadUrl(URL.createObjectURL(blob));
    setDownloadName(name);
    setResultSize(blob.size);
  }

  function parsePageRanges(value: string, pageCount: number) {
    const result = new Set<number>();
    value.split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
      const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) throw new Error("Use page numbers like 1, 3-5, 8.");
      const start = Number(match[1]); const end = Number(match[2] || match[1]);
      if (start < 1 || end < start || end > pageCount) throw new Error(`Page range must be between 1 and ${pageCount}.`);
      for (let page = start; page <= end; page++) result.add(page - 1);
    });
    if (!result.size) throw new Error("Enter at least one page number.");
    return [...result].sort((a, b) => a - b);
  }

  async function imagesToPdf() {
    const output = await PDFDocument.create();
    for (const item of files) {
      const image = await loadImage(item.file);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser couldn't create an image canvas.");
      const isPng = item.file.type === "image/png";
      if (!isPng) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(image, 0, 0);
      let embedded;
      if (isPng) {
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        embedded = await output.embedPng(bytes);
      } else {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image conversion failed.")), "image/jpeg", 0.92));
        embedded = await output.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      }
      const pageWidth = Math.min(14400, Math.max(1, image.naturalWidth * 0.75));
      const pageHeight = Math.min(14400, Math.max(1, image.naturalHeight * 0.75));
      const page = output.addPage([pageWidth, pageHeight]);
      page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      canvas.width = 1; canvas.height = 1;
    }
    saveResult(await output.save(), "ms-pdf-images.pdf");
  }

  async function compressPdf() {
    const [pdfjs, sourceFile] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      files[0].file.arrayBuffer()
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url
    ).toString();
    const presets = {
      high: { scale: 1.8, jpeg: 0.88 },
      medium: { scale: 1.35, jpeg: 0.72 },
      strong: { scale: 1.0, jpeg: 0.55 }
    } as const;
    const preset = presets[quality as keyof typeof presets];
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(sourceFile) });
    const pdf = await loadingTask.promise;
    const output = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const sourcePage = await pdf.getPage(pageNumber);
      const viewport = sourcePage.getViewport({ scale: preset.scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser couldn't create a page canvas.");
      await sourcePage.render({ canvasContext: context, viewport, canvas } as Parameters<typeof sourcePage.render>[0]).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Page compression failed.")), "image/jpeg", preset.jpeg));
      const jpg = await output.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const original = sourcePage.getViewport({ scale: 1 });
      const page = output.addPage([original.width, original.height]);
      page.drawImage(jpg, { x: 0, y: 0, width: original.width, height: original.height });
      canvas.width = 1; canvas.height = 1;
      sourcePage.cleanup();
    }
    await pdf.destroy();
    saveResult(await output.save(), "ms-pdf-compressed.pdf");
  }

  async function pdfToImages() {
    const [pdfjs, sourceFile] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), files[0].file.arrayBuffer()]);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(sourceFile) }).promise;
    const zip = new JSZip();
    const extension = imageFormat === "jpeg" ? "jpg" : "png";
    const mime = imageFormat === "jpeg" ? "image/jpeg" : "image/png";
    const scale = Number(imageScale);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not create an image canvas.");
      await page.render({ canvasContext: context, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image export failed.")), mime, 0.92));
      zip.file("page-" + String(pageNumber).padStart(3, "0") + "." + extension, blob);
      canvas.width = 1; canvas.height = 1; page.cleanup();
    }
    await pdf.destroy();
    const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    saveBlob(archive, "ms-pdf-images.zip");
  }

  async function protectPdf() {
    if (password.length < 6) throw new Error("Use a password with at least 6 characters.");
    if (password !== confirmPassword) throw new Error("The passwords do not match.");
    const { createPdfToolkit } = await import("pdfstudio");
    const toolkit = await createPdfToolkit();
    const encrypted = await toolkit.lock(new Uint8Array(await files[0].file.arrayBuffer()), { userPassword: password, ownerPassword: password, keyLength: 256 });
    saveResult(encrypted, "ms-pdf-protected.pdf"); setPassword(""); setConfirmPassword("");
  }

  async function unlockPdf() {
    if (!password) throw new Error("Enter the PDF current password.");
    const { createPdfToolkit, PdfPasswordError } = await import("pdfstudio");
    const toolkit = await createPdfToolkit();
    try {
      const unlocked = await toolkit.unlock(new Uint8Array(await files[0].file.arrayBuffer()), { password });
      saveResult(unlocked, "ms-pdf-unlocked.pdf"); setPassword("");
    } catch (cause) {
      if (cause instanceof PdfPasswordError) throw new Error("Incorrect password. Check it and try again.");
      throw cause;
    }
  }
  async function addWatermark() {
    if (!watermark.trim()) throw new Error("Enter watermark text.");
    const pdf = await PDFDocument.load(await files[0].file.arrayBuffer());
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(watermark, watermarkSize);
      let x = (width - textWidth) / 2;
      let y = (height - watermarkSize) / 2;
      if (position === "top") y = height - watermarkSize - 35;
      if (position === "bottom") y = 35;
      if (position === "diagonal") { x = (width - textWidth) / 2; y = (height - watermarkSize) / 2; }
      page.drawText(watermark, {
        x, y, size: watermarkSize, font, color: rgb(0.45, 0.45, 0.45),
        opacity, rotate: degrees(position === "diagonal" ? watermarkAngle : 0)
      });
    }
    saveResult(await pdf.save(), "ms-pdf-watermarked.pdf");
  }

  async function processFiles() {
    if (!files.length) { setError(isImageTool ? "Add at least one image first." : "Add a PDF first."); return; }
    if (tool === "merge" && files.length < 2) { setError("Add at least two PDFs to merge."); return; }
    setBusy(true); setError(""); setDownloadUrl("");
    try {
      if (tool === "images") { await imagesToPdf(); return; }
      if (tool === "compress") { await compressPdf(); return; }
      if (tool === "watermark") { await addWatermark(); return; }
      if (tool === "pdf-images") { await pdfToImages(); return; }
      if (tool === "protect") { await protectPdf(); return; }
      if (tool === "unlock") { await unlockPdf(); return; }
      const output = await PDFDocument.create();
      if (tool === "merge") {
        for (const item of files) {
          const source = await PDFDocument.load(await item.file.arrayBuffer());
          const copied = await output.copyPages(source, source.getPageIndices());
          copied.forEach((page) => output.addPage(page));
        }
      } else {
        const source = await PDFDocument.load(await files[0].file.arrayBuffer());
        if (tool === "rotate") {
          source.getPages().forEach((page) => page.setRotation(degrees((page.getRotation().angle + angle) % 360)));
          saveResult(await source.save(), "ms-pdf-rotated.pdf");
          return;
        }
        const indices = parsePageRanges(pages, source.getPageCount());
        const copied = await output.copyPages(source, indices);
        copied.forEach((page) => output.addPage(page));
      }
      saveResult(await output.save(), tool === "merge" ? "ms-pdf-merged.pdf" : "ms-pdf-pages.pdf");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't process this file. Try another one.");
    } finally {
      setBusy(false);
    }
  }

  function chooseTool(next: Tool) {
    setTool(next); setFiles([]); setError(""); setDownloadUrl("");
  }

  const actionLabel = tool === "merge" ? "Merge PDFs" : tool === "split" ? "Extract pages" : tool === "rotate" ? "Rotate PDF" : tool === "images" ? "Convert to PDF" : tool === "compress" ? "Compress PDF" : tool === "watermark" ? "Add watermark" : tool === "pdf-images" ? "Convert to images" : tool === "protect" ? "Protect PDF" : "Unlock PDF";

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="MS PDF home"><span className="brand-mark">MS</span><span>PDF</span></a>
        <div className="topbar-right"><span className="privacy"><ShieldCheck size={15} /> Files stay on your device</span><span className="version">BETA</span></div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-dot" /> SIMPLE PDF TOOLS</div>
        <h1>Kaam ki cheez.<br /><span>Bina bakwaas.</span></h1>
        <p>PDF ka kaam, seedha aur simple. No ads. No signup. No nonsense.</p>
      </section>

      <section className="workspace" aria-label="PDF tools">
        <div className="tool-tabs">
          {tools.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={tool === item.id ? "tool-tab active" : "tool-tab"} onClick={() => chooseTool(item.id)}><Icon size={18} /><span>{item.title}</span></button>;
          })}
        </div>

        <div className="work-card">
          <div className="work-heading">
            <div className="work-icon"><currentTool.icon size={21} /></div>
            <div><h2>{currentTool.title}</h2><p>{currentTool.detail}</p></div>
          </div>

          <label className="dropzone">
            <input type="file" accept={isImageTool ? "image/*" : "application/pdf,.pdf"} multiple={acceptsMultiple} onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
            <span className="upload-icon"><Upload size={22} /></span>
            <strong>{files.length ? "Add more files" : isImageTool ? "Choose images" : "Choose PDF files"}</strong>
            <span>or drop them here · {isImageTool ? "Images supported by your browser" : "PDF only"}</span>
          </label>

          {files.length > 0 && <div className="file-list">
            <div className="list-heading"><span>YOUR FILES <b>{files.length}</b></span><span>{formatSize(totalSize)} total</span></div>
            {files.map((item, index) => <div className="file-row" key={item.id}>
              <div className="file-icon"><FileText size={18} /></div>
              <div className="file-meta"><strong>{item.file.name}</strong><span>{formatSize(item.file.size)}</span></div>
              {(tool === "merge" || tool === "images") && <div className="reorder"><button aria-label="Move up" disabled={index === 0} onClick={() => moveFile(index, -1)}>↑</button><button aria-label="Move down" disabled={index === files.length - 1} onClick={() => moveFile(index, 1)}>↓</button></div>}
              <button className="remove" aria-label="Remove file" onClick={() => removeFile(item.id)}><X size={17} /></button>
            </div>)}
          </div>}

          {tool === "split" && files.length > 0 && <div className="options"><label htmlFor="pages">Pages to extract</label><input id="pages" value={pages} onChange={(event) => setPages(event.target.value)} placeholder="e.g. 1, 3-5, 8" /><small>Enter page numbers or ranges, separated by commas.</small></div>}
          {tool === "rotate" && files.length > 0 && <div className="options"><label>Rotate pages</label><div className="angle-options">{[90, 180, 270].map((value) => <button key={value} className={angle === value ? "angle active" : "angle"} onClick={() => setAngle(value)}>{value}°</button>)}</div></div>}
          {tool === "compress" && files.length > 0 && <div className="options"><label htmlFor="quality">Compression level</label><select id="quality" value={quality} onChange={(event) => setQuality(event.target.value)}><option value="high">High quality · larger file</option><option value="medium">Balanced · recommended</option><option value="strong">Smaller file · lower quality</option></select><small>Pages are converted to images. Text won't remain selectable or searchable.</small></div>}
          {tool === "pdf-images" && files.length > 0 && <div className="options"><label htmlFor="image-format">Image format</label><select id="image-format" value={imageFormat} onChange={(event) => setImageFormat(event.target.value)}><option value="png">PNG · lossless</option><option value="jpeg">JPG / JPEG · smaller files</option></select><label htmlFor="image-scale">Image resolution</label><select id="image-scale" value={imageScale} onChange={(event) => setImageScale(event.target.value)}><option value="1">Standard</option><option value="1.5">High · recommended</option><option value="2">Very high</option></select><small>All pages will be exported into a ZIP file. Higher resolution uses more memory.</small></div>}
          {(tool === "protect" || tool === "unlock") && files.length > 0 && <div className="options"><label htmlFor="pdf-password">{tool === "protect" ? "New password" : "Current PDF password"}</label><input id="pdf-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={tool === "protect" ? "At least 6 characters" : "Enter PDF password"} />{tool === "protect" && <><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter password" /><small>Uses AES-256 encryption. Keep this password safe; MS PDF cannot recover it.</small></>}</div>}
          {tool === "watermark" && files.length > 0 && <div className="options">
            <label htmlFor="watermark">Watermark text</label><input id="watermark" value={watermark} onChange={(event) => setWatermark(event.target.value)} maxLength={80} placeholder="Enter watermark" />
            <div className="two-options"><div><label htmlFor="wm-size">Text size · {watermarkSize}px</label><input id="wm-size" type="range" min="12" max="100" value={watermarkSize} onChange={(event) => setWatermarkSize(Number(event.target.value))} /></div><div><label htmlFor="wm-opacity">Opacity · {Math.round(opacity * 100)}%</label><input id="wm-opacity" type="range" min="0.05" max="0.8" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></div></div>
            <label htmlFor="wm-position">Position</label><select id="wm-position" value={position} onChange={(event) => setPosition(event.target.value)}><option value="center">Center</option><option value="diagonal">Diagonal</option><option value="top">Top</option><option value="bottom">Bottom</option></select>
            {position === "diagonal" && <div className="options"><label htmlFor="wm-angle">Rotation · {watermarkAngle}°</label><input id="wm-angle" type="range" min="-75" max="75" value={watermarkAngle} onChange={(event) => setWatermarkAngle(Number(event.target.value))} /></div>}
          </div>}

          {error && <div className="error" role="alert">{error}</div>}
          {downloadUrl ? <div className="success"><div className="success-mark"><Check size={18} /></div><div className="success-copy"><strong>{tool === "pdf-images" ? "Your images are ready" : "Your PDF is ready"}</strong><span>{downloadName} · {formatSize(resultSize)}</span></div><a className="download" href={downloadUrl} download={downloadName}><ArrowDownToLine size={17} /> Download</a></div> : <button className="primary" disabled={!files.length || busy} onClick={processFiles}>{busy ? "Working..." : <>{actionLabel} <ArrowDownToLine size={17} /></>}</button>}
          <p className="local-note"><ShieldCheck size={14} /> Processed locally in your browser. Your files are never uploaded.</p>
        </div>
      </section>

      <footer><span>© {new Date().getFullYear()} MS PDF</span><span>Less drama. More kaam.</span></footer>
    </main>
  );
}
