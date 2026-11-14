"use client";

import { useMemo, useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { Files, Scissors, RotateCw, ShieldCheck, Upload, X, ArrowDownToLine, Plus, FileText, Check, Menu } from "lucide-react";

type Tool = "merge" | "split" | "rotate";
type PickedFile = { file: File; id: string };

const tools = [
  { id: "merge" as const, title: "Merge PDF", detail: "Combine files into one", icon: Files },
  { id: "split" as const, title: "Split PDF", detail: "Extract the pages you need", icon: Scissors },
  { id: "rotate" as const, title: "Rotate PDF", detail: "Fix page orientation", icon: RotateCw },
];

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const [tool, setTool] = useState<Tool>("merge");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [pages, setPages] = useState("1");
  const [angle, setAngle] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");

  const acceptsMultiple = tool === "merge";
  const currentTool = tools.find((item) => item.id === tool)!;
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const pdfs = Array.from(list).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) { setError("Please choose a PDF file."); return; }
    setError("");
    setDownloadUrl("");
    setFiles((old) => [...old, ...pdfs].map((file, index) => ({ file, id: `${file.name}-${file.lastModified}-${index}` })));
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

  async function processFiles() {
    if (!files.length) { setError("Add a PDF first."); return; }
    if (tool === "merge" && files.length < 2) { setError("Add at least two PDFs to merge."); return; }
    setBusy(true); setError(""); setDownloadUrl("");
    try {
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
          const bytes = await source.save();
          saveResult(bytes, "ms-pdf-rotated.pdf");
          return;
        }
        const indices = parsePageRanges(pages, source.getPageCount());
        const copied = await output.copyPages(source, indices);
        copied.forEach((page) => output.addPage(page));
      }
      const bytes = await output.save();
      saveResult(bytes, tool === "merge" ? "ms-pdf-merged.pdf" : "ms-pdf-pages.pdf");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't process this PDF. Try another file.");
    } finally {
      setBusy(false);
    }
  }

  function saveResult(bytes: Uint8Array, name: string) {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    setDownloadUrl(URL.createObjectURL(blob));
    setDownloadName(name);
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

  function chooseTool(next: Tool) {
    setTool(next); setFiles([]); setError(""); setDownloadUrl("");
  }

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
            <input type="file" accept="application/pdf,.pdf" multiple={acceptsMultiple} onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
            <span className="upload-icon"><Upload size={22} /></span>
            <strong>{files.length ? "Add more PDFs" : "Choose PDF files"}</strong>
            <span>or drop them here · PDF only</span>
          </label>

          {files.length > 0 && <div className="file-list">
            <div className="list-heading"><span>YOUR FILES <b>{files.length}</b></span><span>{formatSize(totalSize)} total</span></div>
            {files.map((item, index) => <div className="file-row" key={item.id}>
              <div className="file-icon"><FileText size={18} /></div>
              <div className="file-meta"><strong>{item.file.name}</strong><span>{formatSize(item.file.size)}</span></div>
              {tool === "merge" && <div className="reorder"><button aria-label="Move up" disabled={index === 0} onClick={() => moveFile(index, -1)}>↑</button><button aria-label="Move down" disabled={index === files.length - 1} onClick={() => moveFile(index, 1)}>↓</button></div>}
              <button className="remove" aria-label="Remove file" onClick={() => removeFile(item.id)}><X size={17} /></button>
            </div>)}
          </div>}

          {tool === "split" && files.length > 0 && <div className="options"><label htmlFor="pages">Pages to extract</label><input id="pages" value={pages} onChange={(event) => setPages(event.target.value)} placeholder="e.g. 1, 3-5, 8" /><small>Enter page numbers or ranges, separated by commas.</small></div>}
          {tool === "rotate" && files.length > 0 && <div className="options"><label>Rotate pages</label><div className="angle-options">{[90, 180, 270].map((value) => <button key={value} className={angle === value ? "angle active" : "angle"} onClick={() => setAngle(value)}>{value}°</button>)}</div></div>}

          {error && <div className="error" role="alert">{error}</div>}
          {downloadUrl ? <div className="success"><div className="success-mark"><Check size={18} /></div><div className="success-copy"><strong>Your PDF is ready</strong><span>{downloadName}</span></div><a className="download" href={downloadUrl} download={downloadName}><ArrowDownToLine size={17} /> Download</a></div> : <button className="primary" disabled={!files.length || busy} onClick={processFiles}>{busy ? "Working..." : <>{tool === "merge" ? "Merge PDFs" : tool === "split" ? "Extract pages" : "Rotate PDF"} <ArrowDownToLine size={17} /></>}</button>}
          <p className="local-note"><ShieldCheck size={14} /> Processed locally in your browser. Your files are never uploaded.</p>
        </div>
      </section>

      <footer><span>© {new Date().getFullYear()} MS PDF</span><span>Less drama. More kaam.</span></footer>
    </main>
  );
}
