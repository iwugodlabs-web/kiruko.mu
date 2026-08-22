
import type { TimeLog, PayrollData } from '../types/api';
import { deriveHourlyRateFromSalary } from '../utils/payroll';

export const calculatePayrollData = (
  timeLogs: TimeLog[],
  hourlyRateOrSalary: number | any = 15,
  filter: 'today' | '7days' | 'month' | '6months' | '1year' = '7days'
): PayrollData => {
  let hourlyRate: number = 15;
  if (typeof hourlyRateOrSalary === 'number') {
    hourlyRate = hourlyRateOrSalary;
  } else if (hourlyRateOrSalary) {
    hourlyRate = deriveHourlyRateFromSalary(hourlyRateOrSalary) || 0;
  }

  if (!Array.isArray(timeLogs) || timeLogs.length === 0) {
    return {
      totalHours: 0,
      estimatedPay: 0,
      completedDays: 0,
      lateDays: 0,
      absentDays: 0,
      deductionForAbsences: 0,
      deductionForLateIns: 0,
      totalDeduction: 0,
      filteredTimeLogs: [],
      hourlyRate,
      totalDays: 0
    };
  }

  const now = new Date();
  const filteredLogs = timeLogs.filter(log => {
    const logDate = new Date((log as any).start_time || (log as any).created_at || now.toISOString());
    const diffTime = Math.abs(now.getTime() - logDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    switch (filter) {
      case 'today':
        return diffDays <= 1;
      case '7days':
        return diffDays <= 7;
      case 'month':
        return diffDays <= 30;
      case '6months':
        return diffDays <= 180;
      case '1year':
        return diffDays <= 365;
      default:
        return true;
    }
  });

  const totalHours = filteredLogs.reduce((total, log) => {
    const hours = (log as any).hours_worked || 0;
    return total + hours;
  }, 0);

  const standardStartTime = '09:00:00';
  const lateDays = filteredLogs.filter(log => {
    const clockIn = (log as any).start_time || (log as any).clock_in_time;
    if (!clockIn) return false;
    let clockInTimeStr = clockIn as string;
    if (clockInTimeStr.includes('T')) clockInTimeStr = clockInTimeStr.split('T')[1];
    if (clockInTimeStr.includes('+')) clockInTimeStr = clockInTimeStr.split('+')[0];
    const timeOnly = clockInTimeStr.substring(0, 8);
    return timeOnly > standardStartTime;
  }).length;

  const completedDays = filteredLogs.filter(log =>
    (log as any).start_time && (log as any).end_time && ((log as any).hours_worked || 0) > 0
  ).length;

  const estimatedPay = totalHours * hourlyRate;
  const deductionForLateIns = lateDays * (0.5 * hourlyRate);
  const deductionForAbsences = 0;
  const totalDeduction = deductionForLateIns + deductionForAbsences;

  const result: PayrollData = {
    totalHours: Math.round(totalHours * 100) / 100,
    estimatedPay: Math.round(estimatedPay * 100) / 100,
    completedDays,
    lateDays,
    absentDays: 0,
    deductionForAbsences: Math.round(deductionForAbsences * 100) / 100,
    deductionForLateIns: Math.round(deductionForLateIns * 100) / 100,
    totalDeduction: Math.round(totalDeduction * 100) / 100,
    filteredTimeLogs: filteredLogs,
    hourlyRate,
    totalDays: filteredLogs.length
  };

  return result;
};

export const getAttendanceStats = (
  timeLogs: TimeLog[],
  filter: 'today' | '7days' | 'month' | '6months' | '1year' = '7days'
) => {
  const payrollData = calculatePayrollData(timeLogs, 15, filter);

  return {
    totalDays: payrollData.totalDays,
    presentDays: payrollData.completedDays,
    lateDays: payrollData.lateDays,
    absentDays: payrollData.absentDays,
    attendanceRate: payrollData.totalDays > 0 ? Math.round((payrollData.completedDays / payrollData.totalDays) * 100) : 0,
    punctualityRate: payrollData.totalDays > 0 ? Math.round(((payrollData.completedDays - payrollData.lateDays) / payrollData.totalDays) * 100) : 0,
  };
};

export const formatCurrency = (amount: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatHours = (hours: number): string => {
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);

  if (minutes === 0) {
    return `${wholeHours}h`;
  }
  return `${wholeHours}h ${minutes}m`;
};

export default {
  calculatePayrollData,
  getAttendanceStats,
  formatCurrency,
  formatHours,
};
