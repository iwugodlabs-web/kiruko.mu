// Canonical payroll helpers shared between web and mobile
export const DEFAULT_MONTHLY_HOURS = 195;
export const DEFAULT_WORKING_DAYS = 22;

export const computeHourlyFromMonthly = (monthly: number, monthlyHours: number = DEFAULT_MONTHLY_HOURS) => {
  if (!monthlyHours || monthlyHours === 0) return 0;
  return monthly / monthlyHours;
};

export const computeMonthlyFromHourly = (hourly: number, monthlyHours: number = DEFAULT_MONTHLY_HOURS) => {
  return hourly * monthlyHours;
};

export const deriveHourlyRateFromSalary = (salaryData?: any) => {
  if (!salaryData) return 0;
  const salaryVal = parseFloat((salaryData as any)?.salary || (salaryData as any)?.basic_monthly || '0') || 0;
  const monthlyHrs = parseFloat((salaryData as any)?.monthly_hours || String(DEFAULT_MONTHLY_HOURS)) || DEFAULT_MONTHLY_HOURS;
  return monthlyHrs ? salaryVal / monthlyHrs : 0;
};

export const deriveAllowanceHourlyFromSalary = (salaryData?: any) => {
  if (!salaryData) return 0;
  const allowanceVal = parseFloat((salaryData as any)?.allowance || '0') || 0;
  const salaryVal = parseFloat((salaryData as any)?.salary || '0') || 0;
  const revenueVal = parseFloat((salaryData as any)?.revenue || '0') || 0;
  const effectiveAllowance = allowanceVal || Math.max(0, revenueVal - salaryVal);
  const monthlyHrs = parseFloat((salaryData as any)?.monthly_hours || String(DEFAULT_MONTHLY_HOURS)) || DEFAULT_MONTHLY_HOURS;
  return monthlyHrs ? effectiveAllowance / monthlyHrs : 0;
};
