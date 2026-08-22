import { useEffect, useMemo, useState } from "react";
import { getDepartments } from "@/services/api";

export function useDepartments(companyId?: number) {
    const [departments, setDepartments] = useState<Array<{ department_id: number; name: string }>>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            if (!companyId) return;
            setLoading(true);
            try {
                const res = await getDepartments(companyId);
                if (Array.isArray(res)) {
                    if (!mounted) return;
                    // Normalize shape
                    const items = res.map((d: any) => ({ department_id: d.department_id ?? d.id, name: d.name ?? d.department_name ?? d.name }));
                    setDepartments(items);
                } else {
                    // ignore error object for now
                    console.warn('getDepartments returned non-array', res);
                }
            } catch (e) {
                setError((e as Error).message || 'Failed to load departments');
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        return () => { mounted = false; };
    }, [companyId]);

    const map = useMemo(() => {
        const m: Record<number, string> = {};
        departments.forEach((d) => { if (d?.department_id) m[d.department_id] = d.name; });
        return m;
    }, [departments]);

    // No default — an unassigned employee should show as unassigned, not silently inherit "Operations"
    const defaultDepartment = '';

    return { departments, departmentsMap: map, defaultDepartment, loading, error };
}

export default useDepartments;
