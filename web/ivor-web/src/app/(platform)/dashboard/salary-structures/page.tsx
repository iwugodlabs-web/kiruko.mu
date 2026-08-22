"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import ComponentsCatalog from "./components/ComponentsCatalog";
import StructuresList from "./components/StructuresList";
import SalaryPreviewWidget from "./components/SalaryPreviewWidget";
import { Layers, Eye, Wrench, HelpCircle } from "lucide-react";
import PayrollGuide from "../payroll/runs/components/PayrollGuide";
import ExampleCallout from "@/components/ui/ExampleCallout";
import RoleGuard from "../../components/RoleGuard";


type Tab = "components" | "structures" | "preview";


export default function SalaryStructuresPage() {
  const { companyId } = useAuth();
  const searchParams = useSearchParams();
  // Deep-links (e.g. the "Edit salary structure" button on an employee's
  // profile) land on ?tab=preview to open the per-employee preview/assign flow.
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(
    initialTab === "preview" || initialTab === "components" ? initialTab : "structures",
  );
  const [guideOpen, setGuideOpen] = useState(false);

  if (!companyId) {
    return <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">Sign in to a company to manage salary structures.</div>;
  }

  return (
    <RoleGuard companyPermissions={["view_salary", "view_payslip", "manage_payroll"]}>
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between pb-5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">Salary Structures</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Define salary components and templates that auto-suggest themselves to employees
            based on department, role, and grade.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40"
          title="Show payroll guide"
        >
          <HelpCircle className="h-4 w-4" />
          Guide
        </button>
      </div>

      <div className="border-b border-zinc-200 dark:border-zinc-800 mb-6">
        <nav className="flex gap-1">
          <TabButton active={tab === "structures"} onClick={() => setTab("structures")} icon={<Layers className="h-4 w-4" />}>
            Structures
          </TabButton>
          <TabButton active={tab === "components"} onClick={() => setTab("components")} icon={<Wrench className="h-4 w-4" />}>
            Components
          </TabButton>
          <TabButton active={tab === "preview"} onClick={() => setTab("preview")} icon={<Eye className="h-4 w-4" />}>
            Preview
          </TabButton>
        </nav>
      </div>

      {tab === "structures" && (
        <>
          <ExampleCallout className="mb-4" caption="A typical Sales-team structure">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-zinc-500 dark:text-zinc-400">Name</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">Sales · Mauritius</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Applies to</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">Department: Sales · Currency: MUR</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Components</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">
                BASIC (earning, fixed) · TRANSPORT (earning, fixed 2,000) · NPF (deduction, 3% basic) ·
                CSG_EE (deduction, 1.5% gross)
              </dd>
            </dl>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              When you assign this structure to a Sales employee, those 4 components flow into every payslip.
            </p>
          </ExampleCallout>
          <StructuresList companyId={companyId} />
        </>
      )}
      {tab === "components" && (
        <>
          <ExampleCallout className="mb-4" caption="Earnings vs. deductions">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-zinc-500 dark:text-zinc-400 uppercase">
                  <th className="text-left py-1 font-medium">Code</th>
                  <th className="text-left py-1 font-medium">Label</th>
                  <th className="text-left py-1 font-medium">Kind</th>
                  <th className="text-left py-1 font-medium">How it&apos;s computed</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-300">
                <tr><td>BASIC</td><td>Basic salary</td><td>Earning</td><td>Fixed (per assignment)</td></tr>
                <tr><td>TRANSPORT</td><td>Transport allowance</td><td>Earning</td><td>Fixed 2,000</td></tr>
                <tr><td>NPF</td><td>National Pension Fund</td><td>Deduction</td><td>3% of BASIC</td></tr>
                <tr><td>CSG_EE</td><td>CSG (employee)</td><td>Deduction</td><td>1.5% of gross</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              Components are atomic. Combine them inside a structure to model an entire payslip.
            </p>
          </ExampleCallout>
          <ComponentsCatalog companyId={companyId} />
        </>
      )}
      {tab === "preview" && (
        <>
          <ExampleCallout className="mb-4" caption="What a populated preview looks like">
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sarah Smith</div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">On Oct 31, 2026 · paid in MUR</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase">Take-home</div>
                  <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">42,300.00</div>
                </div>
              </div>
              <table className="min-w-full text-xs">
                <tbody className="divide-y divide-zinc-50">
                  <tr><td className="px-3 py-1.5">Basic salary <span className="text-zinc-400 dark:text-zinc-500 font-mono">BASIC</span></td><td className="px-3 py-1.5 text-right tabular-nums">45,000.00</td></tr>
                  <tr><td className="px-3 py-1.5">Transport <span className="text-zinc-400 dark:text-zinc-500 font-mono">TRANSPORT</span></td><td className="px-3 py-1.5 text-right tabular-nums">2,000.00</td></tr>
                  <tr><td className="px-3 py-1.5">NPF <span className="text-zinc-400 dark:text-zinc-500 font-mono">NPF</span></td><td className="px-3 py-1.5 text-right tabular-nums text-red-700">−1,350.00</td></tr>
                  <tr><td className="px-3 py-1.5">CSG (employee) <span className="text-zinc-400 dark:text-zinc-500 font-mono">CSG_EE</span></td><td className="px-3 py-1.5 text-right tabular-nums text-red-700">−705.00</td></tr>
                  <tr><td className="px-3 py-1.5">PAYE <span className="text-zinc-400 dark:text-zinc-500 font-mono">PAYE</span></td><td className="px-3 py-1.5 text-right tabular-nums text-red-700">−2,645.00</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              Pick an employee + date to see their actual numbers. Source tags show whether each line came
              from the assigned template, an override, or a one-off.
            </p>
          </ExampleCallout>
          <SalaryPreviewWidget />
        </>
      )}

      <PayrollGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
    </RoleGuard>
  );
}


function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 hover:border-zinc-300"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
