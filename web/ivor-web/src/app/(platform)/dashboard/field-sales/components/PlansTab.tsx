"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Target, UserPlus, Wand2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCompanyUsers, type User } from "@/services/api";
import {
  listPlans,
  createPlan,
  listAssignments,
  assignPlan,
  type CommissionPlan,
  type PlanAssignment,
} from "@/services/fieldSales";
import EmptyState from "@/components/ui/EmptyState";
import Hint from "./Hint";
import type { NavigateTab } from "./types";

interface RuleDraft {
  rule_type: string;
  percent: string;
  amount: string;
  attainment_pct: string;
  metric: "amount" | "units";
  effective_to: string;
  bands: string;
  scope_category: string;
}

const EMPTY_RULE: RuleDraft = {
  rule_type: "flat_percent",
  percent: "3",
  amount: "",
  attainment_pct: "100",
  metric: "amount",
  effective_to: "",
  bands: '[{"up_to_units":100,"percent":"3"},{"percent":"5"}]',
  scope_category: "",
};

const RULE_TYPES = [
  { value: "flat_percent", label: "Flat % of sale", desc: "A percentage of each sale's value." },
  { value: "per_unit", label: "Per unit", desc: "A fixed amount for every unit sold." },
  { value: "spiff", label: "Spiff (time-boxed)", desc: "A temporary bonus that stops on an end date." },
  { value: "tiered", label: "Tiered bands", desc: "Rate changes as volume grows (bands on units)." },
  { value: "target", label: "Target / quota", desc: "Paid only if the rep hits a target level." },
  { value: "team_override", label: "Team override (manager)", desc: "A manager earns a share of their team's commission." },
];

function ruleHelp(r: RuleDraft): string {
  switch (r.rule_type) {
    case "flat_percent":
      return `Rep earns ${r.percent || "?"}% of every sale's value.`;
    case "per_unit":
      return `Rep earns Rs ${r.amount || r.percent || "?"} for each unit sold.`;
    case "spiff":
      return r.amount
        ? `One-off Rs ${r.amount} per sale${r.effective_to ? ` until ${r.effective_to}` : " (set an end date!)"}.`
        : `One-off ${r.percent || "?"}% of the sale${r.effective_to ? ` until ${r.effective_to}` : " (set an end date!)"}.`;
    case "tiered":
      return "The rate steps up once the rep passes each band's unit threshold.";
    case "target":
      return `Rep earns ${r.percent || "?"}% only once they reach ${r.attainment_pct || "?"}% of their ${r.metric} target.`;
    case "team_override":
      return `Manager earns ${r.percent || "?"}% of the commission their team members earn.`;
    default:
      return "";
  }
}

const TEMPLATES: Array<{ name: string; blurb: string; draft: () => RuleDraft }> = [
  {
    name: "Simple 3%",
    blurb: "Everyone earns 3% of every sale.",
    draft: () => ({ ...EMPTY_RULE, rule_type: "flat_percent", percent: "3" }),
  },
  {
    name: "Rs 20 / unit",
    blurb: "Fixed amount per unit sold.",
    draft: () => ({ ...EMPTY_RULE, rule_type: "per_unit", amount: "20" }),
  },
  {
    name: "Tiered 3% → 5%",
    blurb: "3% up to 100 units, then 5%.",
    draft: () => ({ ...EMPTY_RULE, rule_type: "tiered" }),
  },
  {
    name: "Manager 10% override",
    blurb: "Manager earns 10% of their team's commission.",
    draft: () => ({ ...EMPTY_RULE, rule_type: "team_override", percent: "10" }),
  },
];

function buildParams(r: RuleDraft): Record<string, unknown> {
  switch (r.rule_type) {
    case "flat_percent":
      return { percent: r.percent };
    case "per_unit":
      return { amount: r.amount || r.percent };
    case "spiff":
      return r.amount ? { amount: r.amount } : { percent: r.percent };
    case "tiered":
      return { bands: JSON.parse(r.bands) };
    case "target":
      return { percent: r.percent, attainment_pct: r.attainment_pct, metric: r.metric };
    case "team_override":
      return { percent: r.percent };
    default:
      return {};
  }
}

export default function PlansTab({ onNavigate }: { onNavigate: NavigateTab }) {
  const { companyId } = useAuth();
  const [plans, setPlans] = useState<CommissionPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [reps, setReps] = useState<User[]>([]);

  const [draft, setDraft] = useState({ name: "", description: "", trigger: "sale", rules: [EMPTY_RULE] as RuleDraft[] });
  const [assignFor, setAssignFor] = useState<CommissionPlan | null>(null);
  const [assignments, setAssignments] = useState<PlanAssignment[]>([]);
  const [assignRep, setAssignRep] = useState<string>("");
  const [assignFrom, setAssignFrom] = useState("");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const [p, users] = await Promise.all([listPlans(companyId), fetchCompanyUsers(companyId)]);
      setPlans(p);
      if (Array.isArray(users)) setReps(users);
    } catch {
      toast.error("Failed to load commission plans.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function updateRule(i: number, patch: Partial<RuleDraft>) {
    setDraft((d) => ({ ...d, rules: d.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }

  async function handleCreate() {
    if (!companyId || !draft.name.trim()) {
      toast.error("Plan name is required.");
      return;
    }
    try {
      const rules = draft.rules.map((r) => ({
        rule_type: r.rule_type,
        params: buildParams(r),
        effective_to: r.effective_to || null,
        scope_category: r.scope_category || null,
      }));
      await createPlan(companyId, {
        name: draft.name.trim(),
        description: draft.description || null,
        trigger: draft.trigger,
        rules,
      });
      toast.success("Plan created — now assign it to reps so it starts paying.");
      setDraft({ name: "", description: "", trigger: "sale", rules: [EMPTY_RULE] });
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Could not create plan.");
    }
  }

  async function openAssign(plan: CommissionPlan) {
    if (!companyId) return;
    setAssignFor(plan);
    setAssignRep("");
    try {
      setAssignments(await listAssignments(companyId, plan.id));
    } catch {
      setAssignments([]);
    }
  }

  async function handleAssign() {
    if (!companyId || !assignFor || !assignRep) return;
    try {
      await assignPlan(companyId, assignFor.id, {
        private_user_id: Number(assignRep),
        effective_from: assignFrom || null,
      });
      toast.success("Plan assigned.");
      setAssignationsReload();
    } catch {
      toast.error("Could not assign plan.");
    }
  }

  async function setAssignationsReload() {
    if (!companyId || !assignFor) return;
    try {
      setAssignments(await listAssignments(companyId, assignFor.id));
    } catch {
      /* ignore */
    }
  }

  function repName(privateUserId: number): string {
    const u = reps.find((r) => r.private_user?.private_user_id === privateUserId);
    return u ? `${u.private_user?.first_name ?? ""} ${u.private_user?.last_name ?? ""}`.trim() || u.email : `Rep #${privateUserId}`;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Target className="h-4 w-4" /> New plan
        </h2>

        <Hint
          title="A plan decides how reps get paid"
          className="mb-4"
          action={
            <button
              type="button"
              onClick={() => onNavigate("sales")}
              className="whitespace-nowrap rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300"
            >
              Next: Sales →
            </button>
          }
        >
          A plan is one or more <strong>rules</strong>. When a sale is approved, every matching rule
          adds to the rep&apos;s commission. Create a plan here, then{" "}
          <strong>assign it to reps</strong> on the right — a plan that isn&apos;t assigned pays nobody.
        </Hint>

        <div className="mb-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            <Wand2 className="h-3.5 w-3.5" /> Start from a template
          </p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                title={t.blurb}
                onClick={() => setDraft((d) => ({ ...d, rules: [t.draft()] }))}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800/60"
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <input
            placeholder="Plan name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          />
          <input
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          />
          <select
            value={draft.trigger}
            onChange={(e) => setDraft((d) => ({ ...d, trigger: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          >
            <option value="sale">On sale</option>
            <option value="on_collection">On collection</option>
          </select>

          <div className="space-y-3">
            {draft.rules.map((r, i) => (
              <div key={i} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={r.rule_type}
                    onChange={(e) => updateRule(i, { rule_type: e.target.value })}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                  >
                    {RULE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  {draft.rules.length > 1 && (
                    <button
                      onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, idx) => idx !== i) }))}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {RULE_TYPES.find((t) => t.value === r.rule_type)?.desc}
                </p>

                {(r.rule_type === "flat_percent" || r.rule_type === "target" || r.rule_type === "team_override") && (
                  <div className="flex gap-2">
                    <input
                      placeholder="Percent"
                      value={r.percent}
                      onChange={(e) => updateRule(i, { percent: e.target.value })}
                      className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                    />
                    <span className="self-center text-xs text-gray-400">%</span>
                    {r.rule_type === "target" && (
                      <>
                        <input
                          placeholder="Attainment %"
                          value={r.attainment_pct}
                          onChange={(e) => updateRule(i, { attainment_pct: e.target.value })}
                          className="w-28 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                        />
                        <select
                          value={r.metric}
                          onChange={(e) => updateRule(i, { metric: e.target.value as "amount" | "units" })}
                          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                        >
                          <option value="amount">by amount</option>
                          <option value="units">by units</option>
                        </select>
                      </>
                    )}
                  </div>
                )}

                {r.rule_type === "per_unit" && (
                  <input
                    placeholder="Amount per unit"
                    value={r.amount}
                    onChange={(e) => updateRule(i, { amount: e.target.value })}
                    className="w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                  />
                )}

                {r.rule_type === "spiff" && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      placeholder="Percent"
                      value={r.percent}
                      onChange={(e) => updateRule(i, { percent: e.target.value, amount: "" })}
                      className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                    />
                    <input
                      placeholder="or Amount"
                      value={r.amount}
                      onChange={(e) => updateRule(i, { amount: e.target.value })}
                      className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                    />
                    <input
                      type="date"
                      value={r.effective_to}
                      onChange={(e) => updateRule(i, { effective_to: e.target.value })}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                    />
                  </div>
                )}

                {r.rule_type === "tiered" && (
                  <div className="space-y-1">
                    <textarea
                      value={r.bands}
                      onChange={(e) => updateRule(i, { bands: e.target.value })}
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-xs font-mono"
                    />
                    <p className="text-[11px] text-gray-400">
                      JSON bands: <code>{`[{"up_to_units":100,"percent":"3"},{"percent":"5"}]`}</code> — the
                      final band with no <code>up_to_units</code> catches everything above.
                    </p>
                  </div>
                )}

                <input
                  placeholder="Limit to a category (optional)"
                  value={r.scope_category}
                  onChange={(e) => updateRule(i, { scope_category: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-xs"
                />

                <p className="rounded-md bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                  {ruleHelp(r)}
                </p>
              </div>
            ))}
          </div>

          <button
            onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, { ...EMPTY_RULE }] }))}
            className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900"
          >
            <Plus className="h-4 w-4" /> Add rule
          </button>

          <button
            onClick={handleCreate}
            className="w-full rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-3 py-2 text-sm font-medium"
          >
            Create plan
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4">Plans</h2>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : plans.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No plans yet"
            description="Create your first plan on the left — pick a template to start fast, then assign it to reps so it starts paying."
          />
        ) : (
          <ul className="space-y-3">
            {plans.map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-900 dark:text-white">{p.name}</span>
                    <span className="ml-2 text-xs text-gray-500">on {p.trigger.replace("on_", "")}</span>
                  </div>
                  <button
                    onClick={() => openAssign(p)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Assign
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.rules.map((r) => (
                    <span key={r.id} className="rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                      {r.rule_type}: {JSON.stringify(r.params)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {assignFor && (
          <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Assign “{assignFor.name}”</span>
              <button onClick={() => setAssignFor(null)} className="text-xs text-gray-400">Close</button>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Pick a rep and (optionally) a start date. The plan applies to their sales from that
              date onward.
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                value={assignRep}
                onChange={(e) => setAssignRep(e.target.value)}
                className="flex-1 min-w-[150px] rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="">Select rep…</option>
                {reps.map((u) => (
                  <option key={u.private_user?.private_user_id} value={u.private_user?.private_user_id}>
                    {`${u.private_user?.first_name ?? ""} ${u.private_user?.last_name ?? ""}`.trim() || u.email}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={assignFrom}
                onChange={(e) => setAssignFrom(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <button onClick={handleAssign} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium">
                Assign
              </button>
            </div>
            <ul className="text-xs text-gray-500 space-y-0.5">
              {assignments.map((a) => (
                <li key={a.id}>{repName(a.private_user_id)} · from {a.effective_from ?? "—"}</li>
              ))}
              {assignments.length === 0 && <li>No assignments yet.</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
