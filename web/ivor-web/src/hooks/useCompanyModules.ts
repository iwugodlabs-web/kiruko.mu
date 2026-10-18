"use client";

import { useCallback, useEffect, useState } from "react";
import { getCompanyModules, type CompanyModule } from "@/services/modules";

// Cache resolved entitlements per company so the sidebar, page guards and any
// other consumer share one request. Cleared on toggle (see the admin panel).
const cache = new Map<number, CompanyModule[]>();
const inflight = new Map<number, Promise<CompanyModule[]>>();

export function invalidateCompanyModules(companyId?: number | null) {
  if (companyId == null) cache.clear();
  else cache.delete(companyId);
}

/**
 * Resolve which paid modules are enabled for a company.
 *
 * Fails OPEN: if the request errors we treat modules as enabled so a transient
 * network blip never hides a paying customer's UI. The backend `require_module`
 * gate remains the authoritative check.
 */
export function useCompanyModules(companyId?: number | null) {
  const [modules, setModules] = useState<CompanyModule[] | null>(
    companyId != null ? cache.get(companyId) ?? null : null,
  );
  const [loading, setLoading] = useState<boolean>(
    companyId != null && !cache.has(companyId),
  );

  useEffect(() => {
    if (companyId == null) {
      setModules(null);
      setLoading(false);
      return;
    }
    const cached = cache.get(companyId);
    if (cached) {
      setModules(cached);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    let p = inflight.get(companyId);
    if (!p) {
      p = getCompanyModules(companyId);
      inflight.set(companyId, p);
    }
    p.then((list) => {
      cache.set(companyId, list);
      if (alive) setModules(list);
    })
      .catch(() => {
        // Fail open — leave `modules` null so isEnabled() returns true.
        if (alive) setModules(null);
      })
      .finally(() => {
        inflight.delete(companyId);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  const isEnabled = useCallback(
    (moduleKey: string): boolean => {
      if (modules == null) return true; // unknown → optimistic
      const found = modules.find((m) => m.module_key === moduleKey);
      return found ? found.enabled : true; // unregistered key → don't hide
    },
    [modules],
  );

  return { modules, loading, isEnabled };
}
