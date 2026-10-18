"use client";

import { useRef, useState } from "react";
import { api } from "@/services/apiClient";
import { toast } from "sonner";
import { X, Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface Props {
  companyId: number;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Preview = {
  status: "preview";
  total: number;
  ready: number;
  products: string[];
  errors: { row: number; field: string; reason: string }[];
  warnings: { row: number; reason: string }[];
};

/** Columns the CSV/XLSX may contain. `name` is the only required one. */
const COLUMNS: Array<{ key: string; req?: boolean; hint: string }> = [
  { key: "name", req: true, hint: "Product name. Rows with the same name become variants of one product." },
  { key: "category", hint: "Group label (e.g. Beverages). Created automatically if new." },
  { key: "sku", hint: "Variant code. Auto-generated if left blank." },
  { key: "price", hint: "Selling price for this variant." },
  { key: "currency", hint: "Defaults to your company currency." },
  { key: "barcode", hint: "Optional — used by the app's barcode scanner." },
  { key: "brand", hint: "Optional." },
];

export default function ProductImportModal({ companyId, open, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function reset() {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function downloadTemplate() {
    try {
      const r = await api.get(`/companies/${companyId}/products/import/template`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "product_import_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download the template.");
    }
  }

  async function onPick(f: File | null) {
    setFile(f);
    setPreview(null);
    if (!f) return;
    setChecking(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post(`/companies/${companyId}/products/import?dry_run=true`, fd);
      setPreview(r.data as Preview);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not read that file.");
      reset();
    } finally {
      setChecking(false);
    }
  }

  async function confirmImport() {
    if (!file || !preview || preview.ready === 0) return;
    setCommitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post(`/companies/${companyId}/products/import?dry_run=false`, fd);
      const d = r.data as { products_created: number; variants_created: number; skipped: number; failed: unknown[] };
      toast.success(
        `Imported ${d.products_created} product${d.products_created === 1 ? "" : "s"}` +
          ` (${d.variants_created} variant${d.variants_created === 1 ? "" : "s"})` +
          `${d.skipped ? `, skipped ${d.skipped}` : ""}.`,
      );
      onImported();
      onClose();
      reset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Import failed.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-zinc-500" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Import products</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-5 py-5 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3">
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Step 1 — download the template, then add one row per product/variant.
            </div>
            <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <Download className="h-3.5 w-3.5" /> Template (CSV)
            </button>
          </div>

          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-200">What the columns mean</summary>
            <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {COLUMNS.map((c) => (
                <li key={c.key}>
                  <code className="font-mono text-zinc-800 dark:text-zinc-200">{c.key}</code>
                  {c.req && <span className="ml-1 text-red-500">required</span>}
                  {" — "}{c.hint}
                </li>
              ))}
            </ul>
          </details>

          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-6 text-center">
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                   onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
            <Upload className="h-6 w-6 mx-auto text-zinc-400" />
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Step 2 — {file ? <span className="font-medium">{file.name}</span> : "upload your filled CSV or Excel file"}
            </p>
            <button onClick={() => inputRef.current?.click()} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
              {file ? "Choose a different file" : "Choose file"}
            </button>
          </div>

          {checking && (
            <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 font-medium">
                  <CheckCircle2 className="h-3 w-3" /> {preview.ready} ready
                </span>
                {preview.errors.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 px-2 py-0.5 font-medium">
                    <AlertTriangle className="h-3 w-3" /> {new Set(preview.errors.map((e) => e.row)).size} row(s) with errors
                  </span>
                )}
                {preview.warnings.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 font-medium">
                    {preview.warnings.length} warning(s)
                  </span>
                )}
                <span className="text-zinc-400">of {preview.total} rows</span>
              </div>

              {preview.products.length > 0 && (
                <p className="text-xs text-zinc-500">
                  {preview.products.length} product{preview.products.length === 1 ? "" : "s"} in the file:{" "}
                  <span className="text-zinc-700 dark:text-zinc-300">{preview.products.slice(0, 8).join(", ")}{preview.products.length > 8 ? "…" : ""}</span>
                </p>
              )}

              {preview.errors.length > 0 && (
                <div className="rounded-md border border-red-200 dark:border-red-500/30 max-h-44 overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300">
                      <tr><th className="text-left px-3 py-1.5">Row</th><th className="text-left px-3 py-1.5">Field</th><th className="text-left px-3 py-1.5">Problem</th></tr>
                    </thead>
                    <tbody className="text-zinc-700 dark:text-zinc-300">
                      {preview.errors.map((e, i) => (
                        <tr key={i} className="border-t border-red-100 dark:border-red-500/20">
                          <td className="px-3 py-1 tabular-nums">{e.row}</td><td className="px-3 py-1 font-mono">{e.field}</td><td className="px-3 py-1">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <ul className="text-xs text-amber-700 dark:text-amber-300 list-disc pl-5 space-y-0.5 max-h-24 overflow-y-auto">
                  {preview.warnings.map((w, i) => <li key={i}>Row {w.row}: {w.reason}</li>)}
                </ul>
              )}

              {preview.errors.length > 0 && (
                <p className="text-[11px] text-zinc-500">Rows with errors are skipped. Fix them in your file and re-upload to include them.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800 px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">Cancel</button>
          <button
            onClick={confirmImport}
            disabled={!preview || preview.ready === 0 || committing}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {committing ? "Importing…" : preview ? `Import ${preview.ready} row${preview.ready === 1 ? "" : "s"}` : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
