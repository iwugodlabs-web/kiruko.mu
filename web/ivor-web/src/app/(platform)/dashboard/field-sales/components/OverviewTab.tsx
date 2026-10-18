"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trophy, Wallet, TrendingUp, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getLeaderboard,
  getLiability,
  type Leaderboard,
  type LiabilityAccrual,
} from "@/services/fieldSales";
import MetricCard from "@/components/ui/MetricCard";

function monthBounds(d = new Date()): { start: string; end: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

export default function OverviewTab() {
  const { companyId } = useAuth();
  const [period, setPeriod] = useState(() => monthBounds());
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [liability, setLiability] = useState<LiabilityAccrual | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const [b, l] = await Promise.all([
        getLeaderboard(companyId, period.start, period.end),
        getLiability(companyId),
      ]);
      setBoard(b);
      setLiability(l);
    } catch {
      toast.error("Failed to load field sales overview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, period.start, period.end]);

  const max = Math.max(1, ...(board?.entries ?? []).map((e) => Number(e.amount)));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          title="Outstanding liability"
          value={liability ? `${liability.currency} ${liability.total_outstanding}` : "—"}
          subtitle="Earned but not yet on a payslip"
          icon={Wallet}
          color="amber"
        />
        <MetricCard
          title="Pending payroll"
          value={liability ? `${liability.currency} ${liability.pending_payroll}` : "—"}
          subtitle="Approved, not yet pushed"
          icon={TrendingUp}
          color="blue"
        />
        <MetricCard
          title="Reps earning"
          value={board ? String(board.entries.length) : "—"}
          subtitle={board ? `${board.period_start} → ${board.period_end}` : ""}
          icon={Trophy}
          color="green"
        />
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white">Leaderboard</h2>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={period.start}
              onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1"
            />
            <span className="text-gray-400">→</span>
            <input
              type="date"
              value={period.end}
              onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1"
            />
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1 font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">Loading…</div>
        ) : (board?.entries.length ?? 0) === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">No approved sales in this period.</div>
        ) : (
          <ul className="space-y-3">
            {board!.entries.map((e, i) => (
              <li key={e.private_user_id} className="flex items-center gap-3">
                <span className="w-6 text-sm font-semibold text-gray-400">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="truncate font-medium text-gray-900 dark:text-white">
                      {e.name || `Rep #${e.private_user_id}`}
                    </span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-300">
                      {board!.entries[i] && (Number(e.amount)).toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gray-900 dark:bg-white"
                      style={{ width: `${Math.max(4, (Number(e.amount) / max) * 100)}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
