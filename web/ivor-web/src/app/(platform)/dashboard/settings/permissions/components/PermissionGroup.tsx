"use client";

import { PermissionItem, permLabel } from "./types";

interface Props {
  group: string;
  permissions: PermissionItem[];
  selected: Set<string>;
  onChange?: (key: string, checked: boolean) => void;
  readOnly?: boolean;
  showUsage?: boolean;
}

export default function PermissionGroupBlock({
  group,
  permissions,
  selected,
  onChange,
  readOnly = false,
  showUsage = false,
}: Props) {
  const checkedCount = permissions.filter((p) => selected.has(p.key)).length;

  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{group}</p>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {checkedCount}/{permissions.length}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-0 divide-y divide-gray-50 dark:divide-gray-800">
        {permissions.map((perm) => {
          const isChecked = selected.has(perm.key);
          return (
            <label
              key={perm.key}
              className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors text-xs ${
                isChecked
                  ? "bg-blue-50 dark:bg-blue-900/10 text-gray-900 dark:text-gray-100"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              } ${readOnly ? "cursor-default" : ""}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={readOnly}
                onChange={(e) => onChange?.(perm.key, e.target.checked)}
                className="accent-blue-600 shrink-0"
              />
              <span className="truncate">{permLabel(perm.key)}</span>
              {showUsage && perm.used_by_roles > 0 && (
                <span className="ml-auto text-[9px] text-gray-400 shrink-0">
                  {perm.used_by_roles}r
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
