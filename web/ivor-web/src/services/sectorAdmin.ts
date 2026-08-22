import { api } from "./apiClient";

export interface Country {
  code: string;
  name: string;
  currency: string;
  is_active: boolean;
}

export interface Sector {
  id?: number;
  sector_id?: number;
  activity?: string;
  name?: string;
  description?: string | null;
  country_code: string;
  currency: string;
  categories?: SectorCategory[];
}

export interface SectorCategory {
  id: number;
  sector_id: number;
  name: string;
  currency: string;
  grades?: SectorGrade[];
  salary_ranges?: SectorCategorySalary[];
}

export interface SectorGrade {
  id: number;
  sector_id: number;
  sector_category_id: number;
  grade: string | null;
}

export interface SectorCategorySalary {
  id: number;
  sector_category_id: number;
  sector_grade_id: number | null;
  min_years_of_service: number | null;
  max_years_of_service: number | null;
  effective_from: string | null;
  basic_monthly_salary: number | null;
  basic_daily_salary: number | null;
  hourly_rate: number | null;
  productivity: number | null;
  unit: string | null;
  notes: string | null;
  voided_at: string | null;
  voided_by_user_id: number | null;
  voided_reason: string | null;
}

export interface SalaryHistoryYear {
  effective_from: string;
  rows: Array<SectorCategorySalary & { grade: string | null }>;
}

export interface SalaryHistoryResponse {
  category_id: number;
  category_name: string;
  sector_name: string;
  country_code: string;
  currency: string;
  years: SalaryHistoryYear[];
}

export const sectorAdmin = {
  // Countries
  listCountries: () => api.get<Country[]>("/sector/countries").then((r) => r.data),

  // Sectors
  listSectors: (countryCode?: string) =>
    api
      .get<Sector[]>("/sector/all", { params: countryCode ? { country_code: countryCode } : {} })
      .then((r) => r.data),
  createSector: (p: { activity: string; description?: string; country_code: string; currency: string }) =>
    api.post<Sector>("/sector/create", p).then((r) => r.data),
  updateSector: (id: number, p: { activity?: string; description?: string | null; currency?: string }) =>
    api.put<Sector>(`/sector/${id}`, p).then((r) => r.data),
  deleteSector: (id: number, force = false) =>
    api.delete(`/sector/${id}`, { params: force ? { force: true } : {} }),

  // Categories
  listCategoriesForSector: (sectorId: number) =>
    api.get<SectorCategory[]>(`/sector/category/sector/${sectorId}`).then((r) => r.data),
  createCategory: (p: { sector_id: number; name: string; currency: string }) =>
    api.post<SectorCategory>("/sector/category/create", p).then((r) => r.data),
  updateCategory: (id: number, p: { name?: string; currency?: string }) =>
    api.put<SectorCategory>(`/sector/category/${id}`, p).then((r) => r.data),
  deleteCategory: (id: number) => api.delete(`/sector/category/${id}`),

  // Grades
  listGradesForCategory: (categoryId: number) =>
    api.get<SectorGrade[]>(`/sector/grade/category/${categoryId}`).then((r) => r.data),
  createGrade: (p: { sector_id: number; sector_category_id: number; grade?: string | null }) =>
    api.post<SectorGrade>("/sector/grade/create", p).then((r) => r.data),
  updateGrade: (id: number, p: { grade?: string | null }) =>
    api.put<SectorGrade>(`/sector/grade/${id}`, p).then((r) => r.data),
  deleteGrade: (id: number) => api.delete(`/sector/grade/${id}`),

  // Salaries
  history: (categoryId: number) =>
    api.get<SalaryHistoryResponse>(`/sector/category/${categoryId}/history`).then((r) => r.data),
  activeSalary: (categoryId: number, gradeId?: number, asOf?: string) =>
    api
      .get<SectorCategorySalary | null>(`/sector/category/${categoryId}/salary/active`, {
        params: {
          ...(gradeId ? { grade_id: gradeId } : {}),
          ...(asOf ? { as_of: asOf } : {}),
        },
      })
      .then((r) => r.data),
  appendSalary: (
    categoryId: number,
    p: {
      sector_category_id: number;
      sector_grade_id?: number | null;
      effective_from: string; // YYYY-MM-DD
      basic_monthly_salary?: number | null;
      basic_daily_salary?: number | null;
      hourly_rate?: number | null;
      productivity?: number | null;
      unit?: string | null;
      notes?: string | null;
      min_years_of_service?: number | null;
      max_years_of_service?: number | null;
    },
  ) => api.post<SectorCategorySalary>(`/sector/category/${categoryId}/salary`, p).then((r) => r.data),
  voidSalary: (salaryId: number, reason: string) =>
    api
      .post<SectorCategorySalary>(`/sector/category/salary/${salaryId}/void`, { reason })
      .then((r) => r.data),
};
