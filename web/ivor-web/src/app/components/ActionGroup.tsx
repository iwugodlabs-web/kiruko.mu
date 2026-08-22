"use client";
import React from "react";

export default function ActionGroup({
  onView,
  onManage,
  onEdit,
  onDelete,
  disabled = false,
}: {
  onView?: () => void;
  onManage?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {onView && (
        <button
          onClick={onView}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          disabled={disabled}
        >
          View
        </button>
      )}

      {onManage && (
        <button
          onClick={onManage}
          className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
          disabled={disabled}
        >
          Manage
        </button>
      )}

      {onEdit && (
        <button
          onClick={onEdit}
          className="px-3 py-2 bg-transparent border border-gray-600 text-gray-300 rounded-lg text-sm"
          disabled={disabled}
        >
          Edit
        </button>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
          disabled={disabled}
        >
          Delete
        </button>
      )}
    </div>
  );
}
