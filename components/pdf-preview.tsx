"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Eye, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";

type PdfViewport = { width: number; height: number };
type RenderTask = { promise: Promise<void>; cancel: () => void };
type PdfPage = { getViewport: (options: { scale: number }) => PdfViewport; render: (options: unknown) => RenderTask; cleanup: () => void };
type PdfDocument = { numPages: number; getPage: (pageNumber: number) => Promise<PdfPage>; destroy: () => Promise<void> };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;

export default function PdfPreview({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    let loadingTask: { promise: Promise<unknown>; destroy: () => Promise<void> } | null = null;
    setLoading(true); setError(""); setPdf(null); setPageNumber(1); setPageCount(0);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        const documentProxy = await loadingTask.promise as PdfDocument;
        loaded = documentProxy;
        if (cancelled) { await documentProxy.destroy(); return; }
        setPdf(documentProxy); setPageCount(documentProxy.numPages); setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : "Could not open this PDF.";
          setError(message.includes("Password") || message.includes("password") ? "This PDF is password-protected. Unlock it first, then preview it." : message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; if (loaded) void loaded.destroy(); else if (loadingTask) void loadingTask.destroy(); };
  }, [file]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setContainerWidth(container.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !containerWidth) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let pageToClean: PdfPage | null = null;
    setRendering(true); setError("");
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        pageToClean = page;
        const baseViewport = page.getViewport({ scale: 1 });
        const actualZoom = fitWidth ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (containerWidth - 36) / baseViewport.width)) : zoom;
        const viewport = page.getViewport({ scale: actualZoom });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not create the PDF preview.");
        renderTask = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] });
        await renderTask.promise;
        if (!cancelled) setRendering(false);
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : "Could not render this PDF page.";
          if (!message.toLowerCase().includes("cancel")) setError(message);
          setRendering(false);
        }
      } finally { pageToClean?.cleanup(); }
    })();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, pageNumber, zoom, fitWidth, containerWidth]);

  function changeZoom(next: number) {
    setFitWidth(false);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(next * 100) / 100)));
  }

  function fitToWidth() {
    setFitWidth(true);
  }

  function goToPage(value: number) {
    if (!Number.isFinite(value)) return;
    setPageNumber(Math.max(1, Math.min(pageCount, Math.floor(value))));
  }

  return (
    <section className={fullScreen ? "pdf-preview preview-fullscreen" : "pdf-preview"} aria-label="PDF preview">
      <div className="preview-toolbar">
        <div className="preview-document-label"><Eye size={16} /><span>PDF Preview</span></div>
        <div className="preview-page-controls">
          <button type="button" aria-label="Previous page" disabled={!pageCount || pageNumber <= 1 || rendering} onClick={() => goToPage(pageNumber - 1)}><ChevronLeft size={17} /></button>
          <input aria-label="Current page number" type="number" min="1" max={pageCount || 1} value={pageNumber} disabled={!pageCount} onChange={(event) => goToPage(Number(event.target.value))} />
          <span>/ {pageCount || "—"}</span>
          <button type="button" aria-label="Next page" disabled={!pageCount || pageNumber >= pageCount || rendering} onClick={() => goToPage(pageNumber + 1)}><ChevronRight size={17} /></button>
        </div>
        <div className="preview-zoom-controls">
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= MIN_ZOOM && !fitWidth} onClick={() => changeZoom((fitWidth ? 1 : zoom) - ZOOM_STEP)}><ZoomOut size={16} /></button>
          <span>{fitWidth ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_ZOOM && !fitWidth} onClick={() => changeZoom((fitWidth ? 1 : zoom) + ZOOM_STEP)}><ZoomIn size={16} /></button>
          <button type="button" className={fitWidth ? "preview-fit active" : "preview-fit"} onClick={fitToWidth}>Fit width</button>
          <button type="button" aria-label={fullScreen ? "Exit expanded preview" : "Expand preview"} title={fullScreen ? "Exit expanded preview" : "Expand preview"} onClick={() => setFullScreen((current) => !current)}>{fullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <a className="preview-download" href={downloadUrl} download={file.name} aria-label="Download original PDF" title="Download original PDF"><Download size={16} /></a>
        </div>
      </div>
      <div className="preview-canvas-area" ref={containerRef}>
        {(loading || rendering) && <div className="preview-loading">{loading ? "Opening PDF…" : "Rendering page…"}</div>}
        {error && <div className="error preview-error" role="alert">{error}</div>}
        <div className="preview-paper"><canvas ref={canvasRef} /></div>
      </div>
      <div className="preview-status"><span>{file.name}</span><span>{pageCount ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "PDF document"} · {Math.max(1, Math.round(file.size / 1024))} KB</span></div>
    </section>
  );
}
