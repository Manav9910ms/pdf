"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ArrowLeft, ArrowRight, Highlighter, MousePointer2, Pencil, RectangleHorizontal, Type } from "lucide-react";

type Point = { x: number; y: number };
type Viewport = {
  width: number;
  height: number;
  convertToPdfPoint: (x: number, y: number) => [number, number];
  convertToViewportPoint: (x: number, y: number) => [number, number];
};
type PdfPage = {
  getViewport: (options: { scale: number }) => Viewport;
  render: (options: never) => { promise: Promise<void> };
  cleanup: () => void;
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};
type ToolMode = "text" | "draw" | "highlight" | "rectangle";
type TextMark = { id: string; pageIndex: number; kind: "text"; point: Point; text: string; color: string; fontSize: number };
type DrawMark = { id: string; pageIndex: number; kind: "draw"; points: Point[]; color: string; lineWidth: number };
type BoxMark = { id: string; pageIndex: number; kind: "highlight" | "rectangle"; x: number; y: number; width: number; height: number; color: string; lineWidth: number };
type Mark = TextMark | DrawMark | BoxMark;

function toRgb(hex: string) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

export default function PdfEditor({ file, onExport }: { file: File; onExport: (bytes: Uint8Array) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const activePointsRef = useRef<Point[]>([]);
  const [documentProxy, setDocumentProxy] = useState<PdfDocument | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<ToolMode>("text");
  const [text, setText] = useState("Your text");
  const [color, setColor] = useState("#e34242");
  const [fontSize, setFontSize] = useState(18);
  const [lineWidth, setLineWidth] = useState(3);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [activePoints, setActivePoints] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    setLoading(true); setError(""); setDocumentProxy(null); setViewport(null); setPageIndex(0); setPageCount(0); setMarks([]);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        loaded = pdf as unknown as PdfDocument;
        if (cancelled) { await loaded.destroy(); return; }
        setDocumentProxy(loaded); setPageCount(pdf.numPages); setLoading(false);
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : "Could not open this PDF."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; if (loaded) void loaded.destroy(); };
  }, [file]);

  useEffect(() => {
    if (!documentProxy || !canvasRef.current) return;
    let cancelled = false;
    let pageToClean: PdfPage | null = null;
    setLoading(true); setError("");
    (async () => {
      try {
        const page = await documentProxy.getPage(pageIndex + 1);
        pageToClean = page;
        const nextViewport = page.getViewport({ scale: 1.15 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(nextViewport.width); canvas.height = Math.ceil(nextViewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not create a PDF preview.");
        await page.render({ canvasContext: context, viewport: nextViewport, canvas } as never).promise;
        if (!cancelled) { viewportRef.current = nextViewport; setViewport(nextViewport); setLoading(false); }
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : "Could not render this page."); setLoading(false); }
      } finally { pageToClean?.cleanup(); }
    })();
    return () => { cancelled = true; };
  }, [documentProxy, pageIndex]);

  function getPoint(event: React.PointerEvent<SVGSVGElement>): Point | null {
    const activeViewport = viewportRef.current;
    const svg = overlayRef.current;
    if (!activeViewport || !svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (activeViewport.width / rect.width);
    const y = (event.clientY - rect.top) * (activeViewport.height / rect.height);
    const [pdfX, pdfY] = activeViewport.convertToPdfPoint(x, y);
    return { x: pdfX, y: pdfY };
  }

  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (loading || !viewport) return;
    const point = getPoint(event);
    if (!point) return;
    if (mode === "text") {
      if (!text.trim()) { setError("Enter text before placing it on the page."); return; }
      setMarks((current) => [...current, { id: `${Date.now()}-${current.length}`, pageIndex, kind: "text", point, text: text.trim(), color, fontSize }]);
      setError("");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointsRef.current = [point];
    setActivePoints([point]);
  }

  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!activePointsRef.current.length || mode === "text") return;
    const point = getPoint(event);
    if (!point) return;
    const next = mode === "draw" ? [...activePointsRef.current, point] : [activePointsRef.current[0], point];
    activePointsRef.current = next;
    setActivePoints(next);
  }

  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (!activePointsRef.current.length || mode === "text") return;
    const point = getPoint(event);
    const points = point ? (mode === "draw" ? [...activePointsRef.current, point] : [activePointsRef.current[0], point]) : activePointsRef.current;
    if (mode === "draw" && points.length > 1) {
      setMarks((current) => [...current, { id: `${Date.now()}-${current.length}`, pageIndex, kind: "draw", points, color, lineWidth }]);
    } else if ((mode === "highlight" || mode === "rectangle") && points.length > 1) {
      const first = points[0], last = points[1];
      const width = Math.abs(last.x - first.x), height = Math.abs(last.y - first.y);
      if (width > 2 && height > 2) setMarks((current) => [...current, { id: `${Date.now()}-${current.length}`, pageIndex, kind: mode, x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), width, height, color, lineWidth }]);
    }
    activePointsRef.current = []; setActivePoints(null);
  }

  function viewportPoint(point: Point) { return viewport ? viewport.convertToViewportPoint(point.x, point.y) : [0, 0]; }

  async function exportPdf() {
    if (!marks.length) { setError("Add at least one edit before exporting."); return; }
    setBusy(true); setError("");
    try {
      const pdf = await PDFDocument.load(await file.arrayBuffer());
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (const mark of marks) {
        const page = pdf.getPages()[mark.pageIndex];
        if (!page) continue;
        const paint = toRgb(mark.color);
        if (mark.kind === "text") {
          page.drawText(mark.text, { x: mark.point.x, y: mark.point.y, size: mark.fontSize, font, color: paint });
        } else if (mark.kind === "draw") {
          for (let index = 1; index < mark.points.length; index++) {
            page.drawLine({ start: mark.points[index - 1], end: mark.points[index], thickness: mark.lineWidth, color: paint });
          }
        } else {
          page.drawRectangle({ x: mark.x, y: mark.y, width: mark.width, height: mark.height, color: paint, opacity: mark.kind === "highlight" ? 0.28 : 0.08, borderColor: paint, borderWidth: mark.kind === "rectangle" ? mark.lineWidth : 0, borderOpacity: 1 });
        }
      }
      onExport(await pdf.save());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the edited PDF.");
    } finally { setBusy(false); }
  }

  const pageMarks = marks.filter((mark) => mark.pageIndex === pageIndex);
  const activeToolHint = mode === "text" ? "Click the page to place your text." : mode === "draw" ? "Hold and drag to draw." : mode === "highlight" ? "Drag over an area to highlight it." : "Drag to add a rectangle.";

  return (
    <section className="pdf-editor" aria-label="PDF editor">
      <div className="editor-toolbar">
        <div className="editor-tool-group">
          <button type="button" className={mode === "text" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("text")}><Type size={16} /> Text</button>
          <button type="button" className={mode === "draw" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("draw")}><Pencil size={16} /> Draw</button>
          <button type="button" className={mode === "highlight" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("highlight")}><Highlighter size={16} /> Highlight</button>
          <button type="button" className={mode === "rectangle" ? "editor-tool active" : "editor-tool"} onClick={() => setMode("rectangle")}><RectangleHorizontal size={16} /> Rectangle</button>
        </div>
        <div className="editor-settings">
          {mode === "text" && <label className="editor-text-setting"><span>Text</span><input value={text} onChange={(event) => setText(event.target.value)} maxLength={180} /></label>}
          <label className="editor-color-setting" title="Edit color"><span>Color</span><input aria-label="Edit color" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
          {mode === "text" ? <label className="editor-range-setting"><span>Size {fontSize}</span><input aria-label="Text size" type="range" min="8" max="48" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label> : <label className="editor-range-setting"><span>Width {lineWidth}</span><input aria-label="Stroke width" type="range" min="1" max="12" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label>}
        </div>
      </div>
      <div className="editor-hint"><MousePointer2 size={14} /> {activeToolHint} Existing PDF text is not directly editable yet; this tool adds content on top.</div>
      <div className="editor-page-nav">
        <button type="button" className="editor-nav-button" disabled={pageIndex === 0 || loading} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15} /> Previous</button>
        <span>Page <strong>{pageCount ? pageIndex + 1 : 0}</strong> of {pageCount}</span>
        <button type="button" className="editor-nav-button" disabled={!pageCount || pageIndex >= pageCount - 1 || loading} onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}>Next <ArrowRight size={15} /></button>
      </div>
      <div className="editor-preview-scroll">
        {loading && <div className="editor-loading">Loading PDF page…</div>}
        {error && <div className="error editor-error" role="alert">{error}</div>}
        <div className="editor-page" style={viewport ? { width: viewport.width, height: viewport.height } : undefined}>
          <canvas ref={canvasRef} className="editor-canvas" />
          {viewport && <svg ref={overlayRef} className="editor-overlay" viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
            {pageMarks.map((mark) => {
              if (mark.kind === "text") { const [x, y] = viewportPoint(mark.point); return <text key={mark.id} x={x} y={y} fill={mark.color} fontSize={mark.fontSize * 1.15} fontFamily="Arial, sans-serif">{mark.text}</text>; }
              if (mark.kind === "draw") { const points = mark.points.map((point) => viewportPoint(point).join(",")).join(" "); return <polyline key={mark.id} points={points} fill="none" stroke={mark.color} strokeWidth={mark.lineWidth * 1.15} strokeLinecap="round" strokeLinejoin="round" />; }
              const [x1, y1] = viewportPoint({ x: mark.x, y: mark.y + mark.height });
              const [x2, y2] = viewportPoint({ x: mark.x + mark.width, y: mark.y });
              return <rect key={mark.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={mark.color} fillOpacity={mark.kind === "highlight" ? 0.28 : 0.08} stroke={mark.kind === "rectangle" ? mark.color : "none"} strokeWidth={mark.lineWidth * 1.15} />;
            })}
            {activePoints && activePoints.length > 0 && (mode === "draw" ? <polyline points={activePoints.map((point) => viewportPoint(point).join(",")).join(" ")} fill="none" stroke={color} strokeWidth={lineWidth * 1.15} strokeLinecap="round" strokeLinejoin="round" /> : activePoints.length > 1 && <rect x={Math.min(viewportPoint(activePoints[0])[0], viewportPoint(activePoints[1])[0])} y={Math.min(viewportPoint(activePoints[0])[1], viewportPoint(activePoints[1])[1])} width={Math.abs(viewportPoint(activePoints[1])[0] - viewportPoint(activePoints[0])[0])} height={Math.abs(viewportPoint(activePoints[1])[1] - viewportPoint(activePoints[0])[1])} fill={color} fillOpacity={mode === "highlight" ? 0.28 : 0.08} stroke={mode === "rectangle" ? color : "none"} strokeWidth={lineWidth * 1.15} />)}
          </svg>}
        </div>
      </div>
      <div className="editor-footer">
        <span>{marks.length} edit{marks.length === 1 ? "" : "s"} added</span>
        <button type="button" className="editor-clear" disabled={!marks.length || busy} onClick={() => setMarks([])}>Clear edits</button>
        <button type="button" className="primary editor-export" disabled={!marks.length || busy || loading} onClick={exportPdf}>{busy ? "Exporting…" : "Export edited PDF"}</button>
      </div>
    </section>
  );
}
