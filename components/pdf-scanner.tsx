"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Camera, CameraOff, FileImage, ImagePlus, ArrowDown, ArrowUp, ScanLine, Trash2, Upload } from "lucide-react";

type ScanPage = { id: string; blob: Blob; previewUrl: string };
type ScanFilter = "color" | "grayscale" | "blackwhite";

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read one of the scanned pages."));
    image.src = url;
  });
}

function filterCss(filter: ScanFilter) {
  if (filter === "grayscale") return "grayscale(1)";
  if (filter === "blackwhite") return "grayscale(1) contrast(1.8)";
  return "none";
}

export default function PdfScanner({ onExport }: { onExport: (bytes: Uint8Array) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pagesRef = useRef<ScanPage[]>([]);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [filter, setFilter] = useState<ScanFilter>("color");
  const [cameraError, setCameraError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { pagesRef.current = pages; }, [pages]);

  useEffect(() => () => {
    stopStream(streamRef.current);
    pagesRef.current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
  }, []);

  async function startCamera() {
    setCameraBusy(true); setCameraError(""); setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this browser. Use the image upload option instead.");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview could not be started.");
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
    } catch (cause) {
      setCameraError(cause instanceof Error ? cause.message : "Could not access the camera. Check your browser permission.");
      stopStream(streamRef.current); streamRef.current = null;
    } finally { setCameraBusy(false); }
  }

  function stopCamera() {
    stopStream(streamRef.current); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  function appendPage(blob: Blob) {
    const page: ScanPage = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, blob, previewUrl: URL.createObjectURL(blob) };
    setPages((current) => [...current, page]);
    setError("");
  }

  async function capturePage() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) { setCameraError("Camera is still starting. Try again in a moment."); return; }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) { setCameraError("Could not capture this page."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    canvas.width = 1; canvas.height = 1;
    if (!blob) { setCameraError("Could not save this camera capture."); return; }
    appendPage(blob);
    setCameraError("");
  }

  function importImages(list: FileList | null) {
    if (!list?.length) return;
    const images = Array.from(list).filter((file) => file.type.startsWith("image/"));
    if (!images.length) { setError("Choose JPG, PNG, or another supported image file."); return; }
    images.forEach((file) => appendPage(file));
    setError("");
  }

  function removePage(id: string) {
    setPages((current) => {
      const removed = current.find((page) => page.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((page) => page.id !== id);
    });
  }

  function movePage(index: number, direction: number) {
    setPages((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function exportPdf() {
    if (!pages.length) { setError("Scan or upload at least one page first."); return; }
    setExportBusy(true); setError("");
    try {
      const pdf = await PDFDocument.create();
      for (const scannedPage of pages) {
        const image = await loadImage(scannedPage.previewUrl);
        const scale = Math.min(1, 2600 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare a scanned page.");
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.filter = filter === "grayscale" ? "grayscale(1)" : filter === "blackwhite" ? "grayscale(1) contrast(1.8)" : "none";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        context.filter = "none";
        const jpg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not process a scanned image.")), "image/jpeg", 0.88));
        const embedded = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
        const landscape = canvas.width > canvas.height;
        const pageWidth = landscape ? 841.89 : 595.28;
        const pageHeight = landscape ? 595.28 : 841.89;
        const margin = 22;
        const fit = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2) / canvas.height);
        const drawWidth = canvas.width * fit, drawHeight = canvas.height * fit;
        const page = pdf.addPage([pageWidth, pageHeight]);
        page.drawImage(embedded, { x: (pageWidth - drawWidth) / 2, y: (pageHeight - drawHeight) / 2, width: drawWidth, height: drawHeight });
        canvas.width = 1; canvas.height = 1;
      }
      onExport(await pdf.save());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the scanned PDF.");
    } finally { setExportBusy(false); }
  }

  return (
    <section className="pdf-scanner" aria-label="Scan documents to PDF">
      <div className="scanner-camera-card">
        <div className="scanner-camera-heading">
          <div><strong><ScanLine size={17} /> Document camera</strong><span>Use your phone camera or upload existing images</span></div>
          {cameraActive ? <button type="button" className="scanner-secondary" onClick={stopCamera}><CameraOff size={15} /> Stop camera</button> : <button type="button" className="scanner-secondary" disabled={cameraBusy} onClick={startCamera}><Camera size={15} /> {cameraBusy ? "Starting…" : "Start camera"}</button>}
        </div>
        <video ref={videoRef} className={cameraActive ? "scanner-video active" : "scanner-video"} autoPlay playsInline muted />
        {!cameraActive && <div className="scanner-camera-placeholder"><Camera size={30} /><strong>Camera is off</strong><span>Allow camera access when your browser asks</span></div>}
        {cameraActive && <button type="button" className="scanner-capture" onClick={capturePage}><span /> Capture page</button>}
        {cameraError && <div className="error scanner-error" role="alert">{cameraError}</div>}
      </div>

      <div className="scanner-import-row">
        <label className="scanner-upload"><input type="file" accept="image/*" capture="environment" multiple onChange={(event) => { importImages(event.target.files); event.currentTarget.value = ""; }} /><ImagePlus size={16} /> Upload images</label>
        <span>JPG · PNG · HEIC if supported by your browser</span>
      </div>

      <div className="scanner-options">
        <div><strong>Scan filter</strong><span>Applied to every page in the PDF</span></div>
        <div className="scanner-filter-group">
          <button type="button" className={filter === "color" ? "scanner-filter active" : "scanner-filter"} onClick={() => setFilter("color")}>Color</button>
          <button type="button" className={filter === "grayscale" ? "scanner-filter active" : "scanner-filter"} onClick={() => setFilter("grayscale")}>Grayscale</button>
          <button type="button" className={filter === "blackwhite" ? "scanner-filter active" : "scanner-filter"} onClick={() => setFilter("blackwhite")}>B&amp;W</button>
        </div>
      </div>

      <div className="scanner-pages-heading"><strong>Scanned pages <span>{pages.length}</span></strong><small>Use arrows to reorder pages · Remove unwanted pages</small></div>
      {pages.length ? <div className="scanner-page-grid">{pages.map((page, index) => <article className="scanner-page-card" key={page.id}>
        <div className="scanner-page-preview"><img src={page.previewUrl} alt={`Scanned page ${index + 1}`} style={{ filter: filterCss(filter) }} /><span>Page {index + 1}</span></div>
        <div className="scanner-page-actions">
          <button type="button" aria-label={`Move page ${index + 1} up`} disabled={index === 0} onClick={() => movePage(index, -1)}><ArrowUp size={14} /> Up</button>
          <button type="button" aria-label={`Move page ${index + 1} down`} disabled={index === pages.length - 1} onClick={() => movePage(index, 1)}><ArrowDown size={14} /> Down</button>
          <button type="button" aria-label={`Remove page ${index + 1}`} onClick={() => removePage(page.id)}><Trash2 size={14} /></button>
        </div>
      </article>)}</div> : <div className="scanner-empty"><FileImage size={24} /><strong>No pages scanned yet</strong><span>Capture pages with your camera or upload images to begin.</span></div>}

      {error && <div className="error scanner-error" role="alert">{error}</div>}
      <div className="scanner-footer"><span>{pages.length} page{pages.length === 1 ? "" : "s"} · A4 PDF</span><button type="button" className="primary scanner-export" disabled={!pages.length || exportBusy} onClick={exportPdf}><Upload size={16} /> {exportBusy ? "Creating PDF…" : "Create PDF"}</button></div>
      <p className="local-note">Scans are processed locally in your browser. Camera access requires a secure HTTPS connection and your permission.</p>
    </section>
  );
}
