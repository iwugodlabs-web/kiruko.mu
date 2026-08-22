"use client";

/**
 * Multi-select picker for the company's own departments — used by the
 * employer-side announcements form to replace the original "department
 * IDs (CSV)" input. Admins now pick from a list of actual department
 * names instead of having to memorize numeric IDs.
 *
 * Same chip + autocomplete pattern as CompanyMultiPicker. Backed by
 * `getDepartments(companyId)` which hits GET /company/{id}/departments.
 *
 * Renders a friendly hint when the company has no departments yet so
 * the admin understands "empty = all" rather than wondering if the
 * page is broken.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getDepartments } from '@/services/api';
import type { ShowDepartment } from '@/services/api';

interface Props {
    companyId: number | null | undefined;
    value: number[];
    onChange: (ids: number[]) => void;
}

export default function DepartmentMultiPicker({
    companyId,
    value,
    onChange,
}: Props) {
    const [departments, setDepartments] = useState<ShowDepartment[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!companyId) {
            setDepartments([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        getDepartments(companyId)
            .then((res) => {
                if (cancelled) return;
                if ('error' in res) {
                    toast.error(`Could not load departments: ${res.error}`);
                    setDepartments([]);
                } else {
                    setDepartments(res);
                }
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [companyId]);

    const selected = useMemo(() => {
        return value.map((id) => {
            const hit = departments.find((d) => d.department_id === id);
            // Unknown id (deleted dept or different company) still renders
            // as a removable chip so the admin can clean it up.
            return hit ?? ({ department_id: id, name: `#${id}`, company_id: -1 } as ShowDepartment);
        });
    }, [value, departments]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const sel = new Set(value);
        const pool = departments.filter((d) => !sel.has(d.department_id));
        if (!q) return pool.slice(0, 30);
        return pool
            .filter(
                (d) =>
                    d.name.toLowerCase().includes(q) ||
                    String(d.department_id).includes(q),
            )
            .slice(0, 30);
    }, [query, departments, value]);

    function add(id: number) {
        if (value.includes(id)) return;
        onChange([...value, id]);
        setQuery('');
    }
    function remove(id: number) {
        onChange(value.filter((x) => x !== id));
    }

    if (!loading && departments.length === 0) {
        return (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-200 dark:border-gray-700">
                No departments configured for this company yet. Leave empty to
                target all employees, or set up departments in{' '}
                <a href="/dashboard/settings/departments" className="text-emerald-700 dark:text-emerald-400 underline">
                    Settings → Departments
                </a>.
            </div>
        );
    }

    return (
        <div className="relative">
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {selected.map((d) => (
                        <span
                            key={d.department_id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                        >
                            <span className="font-medium">{d.name}</span>
                            <button
                                type="button"
                                onClick={() => remove(d.department_id)}
                                className="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 ml-0.5"
                                aria-label={`Remove ${d.name}`}
                            >
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="flex items-center px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
                <Search size={14} className="text-gray-400 dark:text-gray-500 mr-2 shrink-0" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={loading ? 'Loading departments…' : 'Search by department name'}
                    disabled={loading}
                    className="w-full text-sm bg-transparent dark:text-white dark:placeholder-gray-500 focus:outline-none"
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 200)}
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            {open && !loading && (
                <ul className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 shadow-lg">
                    {filtered.length === 0 && (
                        <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                            {value.length > 0 ? 'No more departments to add.' : 'No match.'}
                        </li>
                    )}
                    {filtered.map((d) => (
                        <li
                            key={d.department_id}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                add(d.department_id);
                            }}
                            className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-sm dark:text-gray-200"
                        >
                            {d.name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
