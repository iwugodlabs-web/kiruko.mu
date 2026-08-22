"use client";

import { useEffect, useState } from "react";
import RoleGuard from "../../components/RoleGuard";
import TaxBracketsTimeline from "./components/TaxBracketsTimeline";
import StatutoryDeductionsTimeline from "./components/StatutoryDeductionsTimeline";
import LeaveDefaultsTimeline from "./components/LeaveDefaultsTimeline";
import BonusRulesTimeline from "./components/BonusRulesTimeline";
import OvertimeRulesTimeline from "./components/OvertimeRulesTimeline";
import HolidaysCalendar from "./components/HolidaysCalendar";
import PayrollRulesGuide, { hasSeenPayrollRulesGuide } from "./components/PayrollRulesGuide";
import PayrollRulesOverview, { RuleType } from "./components/PayrollRulesOverview";
import { ArrowLeft, Globe, HelpCircle } from "lucide-react";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";
import { COUNTRY_FLAGS } from "@/utils/countryDisplay";

const RULE_TITLES: Record<RuleType, string> = {
  tax: "Tax brackets",
  statutory: "Statutory deductions",
  leave: "Leave defaults",
  bonus: "Year-end bonus",
  overtime: "Overtime & premiums",
  holidays: "Public holidays",
};


export default function PayrollRulesPage() {
  const { activeCountry: country, countries } = useCountry();
  const [view, setView] = useState<"overview" | RuleType>("overview");
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!hasSeenPayrollRulesGuide()) setGuideOpen(true);
  }, []);

  const activeCountryInfo = countries.find((c) => c.code === country);
  const isAllCountries = country === ALL_COUNTRIES;

  return (
    <RoleGuard>
    <div className="px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4 pb-5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">Country Payroll Rules</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-3xl">
            Add a new version of a rule when the regulator changes it. Finalized payroll runs
            keep their old rules — only future runs use the new version.{" "}
            {isAllCountries ? (
              "Pick a specific country in the switcher above to manage its rules."
            ) : (
              <>
                Editing
                <span className="font-medium text-zinc-700 dark:text-zinc-300"> {COUNTRY_FLAGS[country] ?? ""} {activeCountryInfo?.name ?? country}</span> —
                switch country in the bar above.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40"
            title="Show payroll-rules guide"
          >
            <HelpCircle className="h-4 w-4" />
            Guide
          </button>
        </div>
      </div>

      {isAllCountries ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <Globe className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Select a country to manage its payroll rules</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Payroll rules always belong to one country — use the switcher above.</p>
        </div>
      ) : view === "overview" ? (
        <PayrollRulesOverview countryCode={country} onManage={(t) => setView(t)} />
      ) : (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => setView("overview")}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900/40"
            >
              <ArrowLeft className="h-4 w-4" />
              Overview
            </button>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {COUNTRY_FLAGS[country] ?? ""} {activeCountryInfo?.name ?? country} · <span className="text-zinc-900 dark:text-zinc-100 font-medium">{RULE_TITLES[view]}</span>
            </div>
          </div>
          {view === "tax" && <TaxBracketsTimeline countryCode={country} />}
          {view === "statutory" && <StatutoryDeductionsTimeline countryCode={country} />}
          {view === "leave" && <LeaveDefaultsTimeline countryCode={country} />}
          {view === "bonus" && <BonusRulesTimeline countryCode={country} />}
          {view === "overtime" && <OvertimeRulesTimeline countryCode={country} />}
          {view === "holidays" && <HolidaysCalendar countryCode={country} />}
        </div>
      )}

      <PayrollRulesGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
    </RoleGuard>
  );
}
