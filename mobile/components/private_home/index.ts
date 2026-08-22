// Export all dashboard components for easy importing
export { default as ClockHistory } from './ClockHistory';
export { default as DashboardHeader } from './DashboardHeader';
export { default as PaySummary } from './PaySummary';
export { default as QuickActions } from './QuickActions';
export { default as TasksManagement } from './TasksManagement';
export { default as EarningsVsExpenses } from './EarningsVsExpenses';
export { default as ProfileProgress } from './ProfileProgress';
export { default as SavingsGoal } from './SavingsGoal';

// Re-export component props types for external use
export type { DashboardHeaderProps } from './DashboardHeader';
export type { PaySummaryProps } from './PaySummary';

// Additional types for component integration
export interface DashboardComponentProps {
  authLoading?: boolean;
  isDataLoading?: boolean;
  currentlyWorking?: boolean;
}

export interface TaskData {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  status: 'assigned' | 'in-progress' | 'completed' | 'overdue';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  estimated_hours?: number;
  completed_hours?: number;
  assignedDate?: string;
}

export interface ClockData {
  day: string;
  date: string;
  time: string;
  hours: number;
  status: string;
  breakTime: number;
}

export interface PayrollData {
  estimatedPay: number;
  totalHours: number;
  overtimeHours: number;
  regularPay: number;
  overtimePay: number;
  bonuses: number;
  deductions: number;
  netPay: number;
  payPeriod: string;
  lastPayDate: string;
  completedDays: number;
  hourlyRate: number;
  breakTime?: number;
  regularHours?: number;
  holidayHours?: number;
  holidayPay?: number;
  allowances?: number;
  filteredTimeLogs?: any[];
}

export interface UserData {
  firstName: string;
  lastName: string;
  email: string;
  department?: string;
  position?: string;
  employeeId?: string;
  profileImage?: string;
  workingStatus?: 'working' | 'break' | 'offline';
  startTime?: string;
}