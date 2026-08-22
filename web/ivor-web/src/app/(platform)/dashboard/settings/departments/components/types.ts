export interface Department {
  department_id: number;
  company_id: number;
  name: string;
  created_at: string | null;
}

export interface DeptEmployee {
  private_user_id: number;
  user_id: number;
  first_name: string;
  last_name: string;
  job_id: number | null;
  job_title: string | null;
  department_id: number | null;
}

export interface DeptWithCount extends Department {
  member_count: number;
}
