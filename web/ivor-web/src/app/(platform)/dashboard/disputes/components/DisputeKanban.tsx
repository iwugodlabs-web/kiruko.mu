"use client";

import { toast } from "sonner";
import { InternalDispute, KANBAN_COLUMNS, DisputeStatus, NEXT_STATUSES, STATUS_LABELS } from "./types";
import DisputeCard from "./DisputeCard";

interface Props {
  disputes: InternalDispute[];
  loading: boolean;
  onCardClick: (d: InternalDispute) => void;
  onStatusChange: (rightId: number, newStatus: DisputeStatus) => void;
}

export default function DisputeKanban({ disputes, loading, onCardClick, onStatusChange }: Props) {
  function handleDragStart(e: React.DragEvent, rightId: number) {
    e.dataTransfer.setData("right_id", String(rightId));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetStatus: DisputeStatus) {
    e.preventDefault();
    const rightId = parseInt(e.dataTransfer.getData("right_id"));
    if (isNaN(rightId)) return;
    const dispute = disputes.find((d) => d.right_id === rightId);
    if (!dispute) return;
    const current = dispute.status as DisputeStatus;
    // No-op when the card is already in the target column.
    if (current === targetStatus) return;
    // Only fire transitions the state machine allows — otherwise the backend
    // 409s and the optimistic move snaps back ("card jumps and reverts").
    const allowed = NEXT_STATUSES[current] ?? [];
    if (!allowed.includes(targetStatus)) {
      toast.error(
        `Can't move "${STATUS_LABELS[current] ?? current}" → "${STATUS_LABELS[targetStatus] ?? targetStatus}".`
      );
      return;
    }
    onStatusChange(rightId, targetStatus);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {KANBAN_COLUMNS.map((col) => {
        const bucket = new Set<string>(col.statuses);
        const colDisputes = disputes.filter((d) => bucket.has(d.status));
        return (
          <div
            key={col.id}
            className="flex-shrink-0 w-64"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.dropTarget)}
          >
            {/* Column header */}
            <div className={`flex items-center justify-between mb-3 pb-2 border-b-2 ${col.color}`}>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{col.label}</span>
              <span className="text-xs font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                {loading ? "…" : colDisputes.length}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-3 min-h-[200px] rounded-xl p-1">
              {loading
                ? Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-28 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
                  ))
                : colDisputes.length === 0
                ? (
                  <div className="flex items-center justify-center h-24 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                    <span className="text-xs text-gray-400 dark:text-gray-500">Drop here</span>
                  </div>
                )
                : colDisputes.map((d) => (
                    <div
                      key={d.right_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, d.right_id)}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <DisputeCard dispute={d} onClick={() => onCardClick(d)} />
                    </div>
                  ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
