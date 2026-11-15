"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Download, Eye, Maximize2, Minimize2,
  ZoomIn, ZoomOut, PanelLeft, RotateCw, Search, FileText,
  X, ChevronDown, Sun, Moon
} from "lucide-react";

type Viewport = { width: number; height: number };
type RenderTask = { promise: Promise<void>; cancel: () => void };
type TextContent = { items: Array<{ str?: string }> };
type PdfPage = {
  getViewport: (options: { scale: number; rotation?: number }) => Viewport;
  render: (options: unknown) => RenderTask;
  getTextContent: () => Promise<TextContent>;
  cleanup: () => void;
  rotate?: number;
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;

function PdfThumbnail({ pdf, pageNumber, active, onClick }: {
  pdf: PdfDocument; pageNumber: number; active: boolean; onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    let pageRef: PdfPage | null = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        pageRef = page;
        const viewport = page.getViewport({ scale: 0.19 });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context || cancelled) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
      } catch { /* A failed thumbnail must not break the document viewer. */ }
      finally { pageRef?.cleanup(); }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber]);
  return (
    <button type="button" className={active ? "preview-thumb active" : "preview-thumb"} onClick={onClick} aria-label={`Go to page ${pageNumber}`} aria-current={active ? "page" : undefined}>
      <span className="preview-thumb-paper"><canvas ref={canvasRef} /></span>
      <span className="preview-thumb-number">{pageNumber}</span>
    </button>
  );
}

export default function PdfPreview({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbListRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<"none" | "width" | "page">("width");
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => { setIsMobile(media.matches); setShowSidebar(!media.matches); setFullScreen(media.matches); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
    setZoom(1); setRotation(0); setFitMode("width"); setSearchResults([]);
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
          setError(/password/i.test(message) ? "This PDF is password-protected. Unlock it first, then preview it." : message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; if (loaded) void loaded.destroy(); else if (loadingTask) void loadingTask.destroy(); };
  }, [file]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fullScreen, showSidebar]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !containerSize.width) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let pageRef: PdfPage | null = null;
    setRendering(true); setError("");
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        pageRef = page;
        const base = page.getViewport({ scale: 1, rotation });
        const availableWidth = Math.max(160, containerSize.width - (isMobile ? 16 : 56));
        const availableHeight = Math.max(180, containerSize.height - 44);
        const widthScale = availableWidth / base.width;
        const pageScale = Math.min(widthScale, availableHeight / base.height);
        const actualZoom = fitMode === "width" ? widthScale : fitMode === "page" ? pageScale : zoom;
        const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, actualZoom));
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const outputScale = Math.min(window.devicePixelRatio || 1, isMobile ? 3 : 2.5);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not create the PDF preview.");
        task = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] });
        await task.promise;
        if (!cancelled) setRendering(false);
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : "Could not render this PDF page.";
          if (!/cancel/i.test(message)) setError(message);
          setRendering(false);
        }
      } finally { pageRef?.cleanup(); }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber, zoom, fitMode, rotation, containerSize, isMobile]);

  const goToPage = useCallback((value: number) => {
    if (!Number.isFinite(value) || !pageCount) return;
    setPageNumber(Math.max(1, Math.min(pageCount, Math.floor(value))));
  }, [pageCount]);

  const changeZoom = (next: number) => {
    setFitMode("none");
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(next * 100) / 100)));
  };

  const runSearch = async () => {
    if (!pdf || !searchTerm.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const matches: number[] = [];
    const needle = searchTerm.trim().toLocaleLowerCase();
    try {
      for (let page = 1; page <= pdf.numPages; page++) {
        const pageProxy = await pdf.getPage(page);
        const content = await pageProxy.getTextContent();
        if (content.items.some((item) => (item.str || "").toLocaleLowerCase().includes(needle))) matches.push(page);
        pageProxy.cleanup();
      }
      setSearchResults(matches);
      setSearchIndex(0);
      if (matches.length) goToPage(matches[0]);
    } catch {
      setError("Could not search this document. Try again.");
    } finally { setSearching(false); }
  };

  const moveSearch = (direction: number) => {
    if (!searchResults.length) return;
    const next = (searchIndex + direction + searchResults.length) % searchResults.length;
    setSearchIndex(next);
    goToPage(searchResults[next]);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault(); setSearchOpen(true); return;
      }
      if (typing) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") goToPage(pageNumber - 1);
      if (event.key === "ArrowRight" || event.key === "PageDown") goToPage(pageNumber + 1);
      if (event.key === "Escape") { setFullScreen(false); setSearchOpen(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goToPage, pageNumber]);

  useEffect(() => {
    const active = thumbListRef.current?.querySelector(".preview-thumb.active") as HTMLElement | null;
    active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pageNumber]);

  return (
    <section className={`pdf-preview ${fullScreen ? "preview-fullscreen" : ""} ${darkMode ? "preview-dark" : ""}`} aria-label="PDF preview">
      <div className="preview-toolbar">
        <div className="preview-toolbar-start">
          <button type="button" className="preview-icon-button" aria-label={showSidebar ? "Hide page thumbnails" : "Show page thumbnails"} title="Page thumbnails" onClick={() => setShowSidebar((v) => !v)}><PanelLeft size={17} /></button>
          <div className="preview-document-label"><Eye size={16} /><span>PDF Reader</span></div>
        </div>
        <div className="preview-page-controls">
          <button type="button" aria-label="Previous page" disabled={!pageCount || pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><ChevronLeft size={17} /></button>
          <input aria-label="Current page number" type="number" min="1" max={pageCount || 1} value={pageNumber} disabled={!pageCount} onChange={(event) => goToPage(Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />
          <span>/ {pageCount || "—"}</span>
          <button type="button" aria-label="Next page" disabled={!pageCount || pageNumber >= pageCount} onClick={() => goToPage(pageNumber + 1)}><ChevronRight size={17} /></button>
        </div>
        <div className="preview-zoom-controls">
          <button type="button" className="preview-mobile-search preview-icon-button" aria-label="Search PDF" title="Search PDF" onClick={() => setSearchOpen((v) => !v)}><Search size={16} /></button>
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= MIN_ZOOM && fitMode === "none"} onClick={() => changeZoom((fitMode === "none" ? zoom : 1) - ZOOM_STEP)}><ZoomOut size={16} /></button>
          <span>{fitMode === "width" ? "Fit width" : fitMode === "page" ? "Fit page" : `${Math.round(zoom * 100)}%`}</span>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_ZOOM && fitMode === "none"} onClick={() => changeZoom((fitMode === "none" ? zoom : 1) + ZOOM_STEP)}><ZoomIn size={16} /></button>
          <button type="button" className={fitMode === "width" ? "preview-fit active" : "preview-fit"} onClick={() => setFitMode("width")}>Fit width</button>
          <button type="button" className={fitMode === "page" ? "preview-fit active" : "preview-fit"} onClick={() => setFitMode("page")}>Fit page</button>
          <button type="button" className="preview-icon-button" aria-label="Rotate page" title="Rotate page" onClick={() => setRotation((v) => (v + 90) % 360)}><RotateCw size={16} /></button>
          <button type="button" className="preview-icon-button" aria-label="Toggle dark mode" title="Toggle dark mode" onClick={() => setDarkMode((v) => !v)}>{darkMode ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button type="button" className="preview-icon-button" aria-label={fullScreen ? "Exit full screen" : "Enter full screen"} title={fullScreen ? "Exit full screen" : "Full screen"} onClick={() => setFullScreen((v) => !v)}>{fullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <a className="preview-download" href={downloadUrl} download={file.name} aria-label="Download original PDF" title="Download original PDF"><Download size={16} /></a>
        </div>
      </div>

      {searchOpen && (
        <div className="preview-searchbar">
          <Search size={16} />
          <input autoFocus value={searchTerm} placeholder="Find text in this PDF…" aria-label="Search PDF text" onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); if (event.key === "Escape") setSearchOpen(false); }} />
          <button type="button" className="preview-search-action" onClick={() => void runSearch()} disabled={searching || !searchTerm.trim()}>{searching ? "Searching…" : "Find"}</button>
          {searchResults.length > 0 && <><span className="preview-search-count">{searchIndex + 1} / {searchResults.length}</span><button type="button" className="preview-icon-button" aria-label="Previous match" onClick={() => moveSearch(-1)}><ChevronLeft size={16} /></button><button type="button" className="preview-icon-button" aria-label="Next match" onClick={() => moveSearch(1)}><ChevronRight size={16} /></button></>}
          {searchResults.length === 0 && !searching && searchTerm.trim() && <span className="preview-search-count">No matches yet</span>}
          <button type="button" className="preview-icon-button" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={16} /></button>
        </div>
      )}

      <div className="preview-reader-body">
        {showSidebar && (
          <aside className="preview-sidebar" aria-label="Page thumbnails">
            <div className="preview-sidebar-heading"><span>Pages</span><span>{pageCount || "—"}</span></div>
            <div className="preview-thumbnails" ref={thumbListRef}>
              {pdf && Array.from({ length: pageCount }, (_, index) => (
                <PdfThumbnail key={index + 1} pdf={pdf} pageNumber={index + 1} active={pageNumber === index + 1} onClick={() => goToPage(index + 1)} />
              ))}
            </div>
          </aside>
        )}
        <div
          className="preview-canvas-area"
          ref={containerRef}
          onTouchStart={(event) => { if (fullScreen) touchStartX.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (!fullScreen || touchStartX.current === null) return;
            const delta = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(delta) > 55) goToPage(pageNumber + (delta < 0 ? 1 : -1));
          }}
        >
          {loading && <div className="preview-loading"><span className="preview-spinner" /> Opening PDF…</div>}
          {!loading && rendering && <div className="preview-loading preview-loading-small">Rendering page…</div>}
          {error && <div className="error preview-error" role="alert">{error}</div>}
          {!error && <div className="preview-paper"><canvas ref={canvasRef} /></div>}
          {!loading && !error && pageCount > 1 && (
            <div className="preview-bottom-nav">
              <button type="button" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1}><ChevronLeft size={15} /> Previous</button>
              <span>Page {pageNumber} of {pageCount}</span>
              <button type="button" onClick={() => goToPage(pageNumber + 1)} disabled={pageNumber >= pageCount}>Next <ChevronRight size={15} /></button>
            </div>
          )}
        </div>
      </div>
      <div className="preview-status">
        <span className="preview-file-name"><FileText size={13} />{file.name}</span>
        <span>{pageCount ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "PDF document"} · {Math.max(1, Math.round(file.size / 1024))} KB</span>
        <span className="preview-shortcuts">← → Navigate · Ctrl + F Search · Esc Close</span>
      </div>
    </section>
  );
}
