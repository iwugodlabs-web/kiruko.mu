import { api } from "./apiClient";

// Per-company feature entitlements. A module is a paid capability a platform
// admin switches on for a single company (e.g. "field_sales"). The backend is
// the real gate; these helpers let the UI hide the related navigation.

export interface CompanyModule {
  module_key: string;
  label: string;
  description: string;
  enabled: boolean;
  enabled_at?: string | null;
}

export async function getCompanyModules(companyId: number): Promise<CompanyModule[]> {
  const res = await api.get(`/companies/${companyId}/modules`);
  return (res.data?.modules ?? []) as CompanyModule[];
}

export async function setCompanyModule(
  companyId: number,
  moduleKey: string,
  enabled: boolean,
): Promise<{ company_id: number; module_key: string; enabled: boolean }> {
  const res = await api.put(`/admin/companies/${companyId}/modules/${moduleKey}`, { enabled });
  return res.data;
}
