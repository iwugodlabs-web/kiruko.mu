"use client";

import {
  VaultDoc, DOC_TYPES, docTypeConfig,
  expiryStatus, daysUntilExpiry, EXPIRY_CHIP, EXPIRY_LABEL,
} from "./types";
import { ExternalLink, Trash2, User } from "lucide-react";

interface Props {
  docs: VaultDoc[];
  loading: boolean;
  filterType: string;
  onDelete: (docId: number) => void;
}

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-100 dark:border-gray-700">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export default function DocumentListTable({ docs, loading, filterType, onDelete }: Props) {
  const filtered = filterType ? docs.filter((d) => d.doc_type === filterType) : docs;

  if (!loading && filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
        <p className="text-sm font-medium">No documents found</p>
        <p className="text-xs mt-1">
          {filterType ? `No ${docTypeConfig(filterType).label} documents yet.` : "Upload the first document using the button above."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
            <th className="px-4 py-3 font-semibold">Document</th>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Employee</th>
            <th className="px-4 py-3 font-semibold">Expiry</th>
            <th className="px-4 py-3 font-semibold">Uploaded</th>
            <th className="px-4 py-3 font-semibold w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
            : filtered.map((doc) => {
                const cfg = docTypeConfig(doc.doc_type);
                const status = expiryStatus(doc.expiry_date);
                const days = daysUntilExpiry(doc.expiry_date);
                const chipCls = EXPIRY_CHIP[status];
                const chipLabel = EXPIRY_LABEL[status](days);

                return (
                  <tr
                    key={doc.doc_id}
                    className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  >
                    {/* Document name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{cfg.emoji}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">{doc.name}</p>
                          {doc.file_name && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[180px]">{doc.file_name}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">
                        {cfg.label}
                      </span>
                    </td>

                    {/* Employee */}
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                        <User size={12} className="text-gray-400 shrink-0" />
                        {doc.employee_name}
                      </p>
                    </td>

                    {/* Expiry */}
                    <td className="px-4 py-3">
                      {doc.expiry_date ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${chipCls}`}>
                          {chipLabel}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>

                    {/* Uploaded */}
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {doc.created_at
                        ? new Date(doc.created_at).toLocaleDateString([], { dateStyle: "medium" })
                        : "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {doc.file_url && (
                          <a
                            href={doc.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View document"
                            className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button
                          onClick={() => onDelete(doc.doc_id)}
                          title="Delete document"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
