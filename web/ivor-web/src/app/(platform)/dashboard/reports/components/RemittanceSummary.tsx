"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/services/apiClient";
import { ChevronLeft, ChevronRight, Download, FileText, Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  companyId: number;
}

type StatLine = { code: string; employee: string; employer: string; total: string };
type EmployeeRow = { name: string; paye: string; statutory: Record<string, string> };
type Remittance = {
  period: string;
  currency: string;
  finalized: boolean;
  employee_count: number;
  paye_total: string;
  statutory: StatLine[];
  grand_total: string;
  employees: EmployeeRow[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmt(v: string | number, currency: string) {
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RemittanceSummary({ companyId }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [data, setData] = useState<Remittance | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/payroll/companies/${companyId}/remittance`, { params: { year, month } });
      setData(res.data as Remittance);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, year, month]);

  useEffect(() => { load(); }, [load]);

  function shift(delta: number) {
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  }

  function exportCSV() {
    if (!data || !data.finalized) return;
    const codes = Array.from(new Set(data.employees.flatMap((e) => Object.keys(e.statutory)))).sort();
    const rows: string[][] = [];
    rows.push([`Statutory remittance — ${MONTHS[month - 1]} ${year}`]);
    rows.push([`Currency: ${data.currency}`, `Employees: ${String(data.employee_count)}`]);
    rows.push([]);
    rows.push(["Employee", "PAYE", ...codes]);
    data.employees.forEach((e) => rows.push([e.name, e.paye, ...codes.map((c) => e.statutory[c] ?? "0.00")]));
    rows.push([]);
    rows.push(["TOTALS"]);
    rows.push(["PAYE", data.paye_total]);
    data.statutory.forEach((s) => rows.push([s.code, `EE ${s.employee}`, `ER ${s.employer}`, `Total ${s.total}`]));
    rows.push(["GRAND TOTAL TO REMIT", data.grand_total]);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `remittance_${year}-${String(month).padStart(2, "0")}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Remittance CSV downloaded");
  }

  async function downloadPDF() {
    if (!data?.finalized) return;
    try {
      const res = await api.get(`/payroll/companies/${companyId}/remittance.pdf`, {
        params: { year, month }, responseType: "blob",
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url; a.download = `remittance_${year}-${String(month).padStart(2, "0")}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not generate the PDF.");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Statutory remittance</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">PAYE, CSG &amp; NSF to remit for the period.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </button>
          <span className="text-sm font-medium text-gray-900 dark:text-white min-w-[7.5rem] text-center tabular-nums">{MONTHS[month - 1]} {year}</span>
          <button onClick={() => shift(1)} className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800" aria-label="Next month">
            <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </button>
          {data?.finalized && (
            <>
              <button onClick={exportCSV} className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button onClick={downloadPDF} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
                <FileText className="h-3.5 w-3.5" /> PDF
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : !data || !data.finalized ? (
        <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No finalized payroll run for {MONTHS[month - 1]} {year}. Finalize the run to see what&apos;s due.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Contribution</th>
                  <th className="text-right px-4 py-2 font-medium">Employee</th>
                  <th className="text-right px-4 py-2 font-medium">Employer</th>
                  <th className="text-right px-4 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-900 dark:text-gray-100">
                <tr>
                  <td className="px-4 py-2 font-medium">PAYE</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(data.paye_total, data.currency)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">—</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(data.paye_total, data.currency)}</td>
                </tr>
                {data.statutory.map((s) => (
                  <tr key={s.code}>
                    <td className="px-4 py-2 font-medium">{s.code}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(s.employee, data.currency)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(s.employer, data.currency)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(s.total, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-blue-50 dark:bg-blue-500/10">
                <tr>
                  <td className="px-4 py-2.5 font-semibold text-blue-900 dark:text-blue-200" colSpan={3}>
                    Total to remit · {data.employee_count} employee{data.employee_count === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-blue-900 dark:text-blue-200">{fmt(data.grand_total, data.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
            Figures sum the finalized run&apos;s payslips for this period (corrections included). A guide for filing — verify against the relevant authority.
          </p>
        </>
      )}
    </div>
  );
}
