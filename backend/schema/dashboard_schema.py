from pydantic import BaseModel
from typing import Dict, List, Optional

class OverviewStats(BaseModel):
    assignedTasks: int
    scheduledEmployees: int
    clockedInEmployees: int
    pendingRequests: int
    openPositions: int
    overdueTasks: Optional[int] = 0
    activeOvertime: Optional[int] = 0
    clockInAnomalies: Optional[int] = 0
    expiringDocuments: Optional[int] = 0
    totalGrossPayroll: Optional[float] = 0.0
    totalWorkHours: Optional[float] = 0.0

class LeaveTypeStats(BaseModel):
    total: int
    pending: int
    approved: int

class RoleStats(BaseModel):
    title: str
    count: int
    tenure: str
    description: str

class DepartmentStats(BaseModel):
    name: str
    count: int
    roles: List[RoleStats]

class HeadCountStats(BaseModel):
    totalEmployees: int
    departments: List[DepartmentStats]

class DashboardData(BaseModel):
    overview: OverviewStats
    leaveManagement: Dict[str, LeaveTypeStats]
    headCount: HeadCountStats

    class Config:
        from_attributes = True