"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { fetchLeavesByCompany, approveOrRejectLeave } from "../../../../services/api";
import { useAuth } from "@/contexts/AuthContext";
import FilterSelect from "@/components/ui/FilterSelect";

type Request = {
  id: number;
  employee: string;
  email?: string;
  type: string;
  status: "Pending" | "Approved" | "Declined";
  date: string;
  endDate?: string;
  reason?: string;
  duration?: string;
  // Approval/rejection details
  approvedBy?: number;
  approvedAt?: string;
  rejectionReason?: string;
  approverComments?: string;
  createdAt?: string;
};

export default function Leaves({ refreshKey }: { refreshKey?: number } = {}) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});

  // Modal state for approve/reject dialog
  const [actionModal, setActionModal] = useState<{
    open: boolean;
    requestId: number | null;
    action: 'approve' | 'reject' | null;
    employeeName: string;
  }>({ open: false, requestId: null, action: null, employeeName: '' });
  const [approverComments, setApproverComments] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Detail modal state
  const [detailModal, setDetailModal] = useState<{ open: boolean; request: Request | null }>({
    open: false,
    request: null
  });

  const loadLeavesForCompany = async (companyId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLeavesByCompany(companyId);
      if ((res as any)?.error) {
        setError((res as any).error || 'Failed to fetch leaves');
        setRequests([]);
      } else {
        const payload = Array.isArray(res) ? res : (res as any).data ?? [];
        const mapped = (payload as any[]).map((l) => {
          // Get employee name - prioritize requester_name from backend
          let employeeName = l.requester_name;
          if (!employeeName || employeeName === 'Unknown') {
            // Fallback to private_user fields
            if (l.private_user?.first_name) {
              employeeName = `${l.private_user.first_name} ${l.private_user.last_name || ''}`.trim();
            } else if (l.requester_email) {
              employeeName = l.requester_email;
            } else if (l.private_user?.email) {
              employeeName = l.private_user.email;
            } else {
              employeeName = 'Unknown';
            }
          }

          // Get notes/reason - prioritize notes field
          const reason = l.notes || l.reason || l.rejection_reason || l.comment || '';

          return {
            id: l.leave_id || l.id,
            employee: employeeName,
            email: l.requester_email || l.private_user?.email || '',
            type: l.leave_type || 'Leave',
            status: (l.status || 'Pending').charAt(0).toUpperCase() + (l.status || 'Pending').slice(1),
            date: l.start_date || l.created_at || l.date || '',
            endDate: l.end_date || '',
            reason: reason,
            duration: l.duration || l.days || '',
            // Approval/rejection details
            approvedBy: l.approved_by,
            approvedAt: l.approved_at,
            rejectionReason: l.rejection_reason || '',
            approverComments: l.approver_comments || '',
            createdAt: l.created_at || '',
          };
        });
        setRequests(mapped as Request[]);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load leave requests');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const { user } = useAuth();
  const companyId = (user as any)?.company?.company_id ?? (user as any)?.private_user?.company_id ?? undefined;

  useEffect(() => {
    if (companyId) {
      loadLeavesForCompany(companyId);
    } else {
      setLoading(false);
    }
  }, [refreshKey, companyId]);

  const [filter, setFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const LEAVES_PER_PAGE = 20;

  const openActionModal = (id: number, action: 'approve' | 'reject', employeeName: string) => {
    setActionModal({ open: true, requestId: id, action, employeeName });
    setApproverComments('');
    setRejectionReason('');
  };

  const closeActionModal = () => {
    setActionModal({ open: false, requestId: null, action: null, employeeName: '' });
    setApproverComments('');
    setRejectionReason('');
  };

  const confirmAction = async () => {
    if (!actionModal.requestId || !actionModal.action) return;

    const id = actionModal.requestId;
    const newStatus = actionModal.action === 'approve' ? 'Approved' : 'Declined';

    // Validate rejection reason is required
    if (actionModal.action === 'reject' && !rejectionReason.trim()) {
      setError('Rejection reason is required');
      return;
    }

    // Optimistic UI
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus as "Pending" | "Approved" | "Declined" } : r)));
    setActionLoading((s) => ({ ...s, [id]: true }));
    setError(null);
    closeActionModal();

    try {
      const payload: any = {};
      if (actionModal.action === 'approve') {
        payload.approver_comments = approverComments;
      } else {
        payload.rejection_reason = rejectionReason;
        payload.approver_comments = approverComments;
      }

      const res = await approveOrRejectLeave(id, actionModal.action, payload);
      if ((res as any)?.error) {
        setError((res as any).error || 'Failed to update leave status');
        await loadLeavesForCompany(companyId);
      } else {
        await loadLeavesForCompany(companyId);
        // Refresh the sidebar's pending-leave badge (it listens for this).
        window.dispatchEvent(new Event('tasks:updated'));
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update leave request');
      await loadLeavesForCompany(companyId);
    } finally {
      setActionLoading((s) => ({ ...s, [id]: false }));
    }
  };

  const filteredRequests = requests.filter(req => {
    if (filter !== "all" && req.status.toLowerCase() !== filter) return false;
    if (leaveTypeFilter && req.type.toLowerCase() !== leaveTypeFilter.toLowerCase()) return false;
    if (dateFrom && req.date && req.date < dateFrom) return false;
    if (dateTo && req.date && req.date > dateTo) return false;
    return true;
  });

  const totalPages = Math.ceil(filteredRequests.length / LEAVES_PER_PAGE);
  const paginatedRequests = filteredRequests.slice(page * LEAVES_PER_PAGE, (page + 1) * LEAVES_PER_PAGE);

  // Unique leave types for dropdown
  const leaveTypes = Array.from(new Set(requests.map(r => r.type).filter(Boolean)));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Approved":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case "Declined":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{filteredRequests.length}</span> request{filteredRequests.length !== 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Status pills */}
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5">
            {["all", "pending", "approved", "declined"].map((status) => (
              <button
                key={status}
                onClick={() => { setFilter(status); setPage(0); }}
                className={`px-3 py-1.5 rounded-md transition-all text-sm font-medium capitalize ${filter === status
                  ? "bg-gray-900 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                  }`}
              >
                {status}
              </button>
            ))}
          </div>

          {/* Leave type filter */}
          {leaveTypes.length > 0 && (
            <FilterSelect
              label=""
              value={leaveTypeFilter}
              onChange={(v) => { setLeaveTypeFilter(v); setPage(0); }}
              options={[{ value: "", label: "All types" }, ...leaveTypes.map((t) => ({ value: t, label: t }))]}
            />
          )}

          {/* Date range */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-400 transition-colors"
          />
          <span className="text-xs text-gray-400">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-400 transition-colors"
          />
        </div>
      </div>

      {/* Table or empty state */}
      {loading ? (
        <div className="flex items-center justify-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl py-16 text-center">
          <div className="w-12 h-12 mx-auto bg-gray-50 rounded-lg flex items-center justify-center mb-4">
            <ClipboardCheck className="w-6 h-6 text-gray-300" />
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">No requests found</p>
          <p className="text-sm text-gray-500">There are no leave requests matching your filters.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Employee</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Type</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Period</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Status</th>
                <th className="px-5 py-3.5 text-xs font-medium text-gray-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {paginatedRequests.map((req) => (
                <tr
                  key={req.id}
                  onClick={() => setDetailModal({ open: true, request: req })}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-700 shrink-0">
                        {req.employee.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{req.employee}</p>
                        {req.email && <p className="text-xs text-gray-400 truncate max-w-40">{req.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{req.type}</p>
                    {req.reason && <p className="text-xs text-gray-400 truncate max-w-[180px]">{req.reason}</p>}
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{new Date(req.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    {req.duration && <p className="text-xs text-gray-400">{req.duration}</p>}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant={req.status} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {req.status === "Pending" ? (
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); openActionModal(req.id, 'approve', req.employee); }}
                          className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md transition-colors"
                          title="Approve"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openActionModal(req.id, 'reject', req.employee); }}
                          className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-md transition-colors"
                          title="Reject"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Processed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <p className="text-xs text-gray-500">
            Showing {page * LEAVES_PER_PAGE + 1}–{Math.min(filteredRequests.length, (page + 1) * LEAVES_PER_PAGE)} of {filteredRequests.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >Previous</button>
            <span className="text-xs text-gray-400">Page {page + 1} / {totalPages}</span>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >Next</button>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {actionModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div onClick={closeActionModal} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl p-6 animate-in zoom-in-95 fade-in duration-200">
            <div className="flex items-center gap-3 mb-5">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${actionModal.action === 'approve' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                {actionModal.action === 'approve' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {actionModal.action === 'approve' ? 'Approve leave request' : 'Reject leave request'}
                </h3>
                <p className="text-xs text-gray-500">For {actionModal.employeeName}</p>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              {actionModal.action === 'reject' ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Reason for rejection <span className="text-red-500">*</span></label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Enter reason..."
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-gray-400 dark:focus:border-gray-600 transition-colors resize-none min-h-[90px]"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Comments <span className="text-gray-400">(optional)</span></label>
                  <textarea
                    value={approverComments}
                    onChange={(e) => setApproverComments(e.target.value)}
                    placeholder="Add a note..."
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-gray-400 dark:focus:border-gray-600 transition-colors resize-none min-h-20"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={closeActionModal} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={confirmAction}
                className={`flex-1 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${actionModal.action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-900 hover:bg-gray-800'}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailModal.open && detailModal.request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div onClick={() => setDetailModal({ open: false, request: null })} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl animate-in zoom-in-95 fade-in duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Request Details</h3>
                <p className="text-xs text-gray-500">Ref #{detailModal.request.id}</p>
              </div>
              <button onClick={() => setDetailModal({ open: false, request: null })} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                <div className="w-10 h-10 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center text-sm font-semibold text-gray-700 dark:text-gray-300 shadow-sm">
                  {detailModal.request.employee.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{detailModal.request.employee}</p>
                  {detailModal.request.email && <p className="text-xs text-gray-500 truncate">{detailModal.request.email}</p>}
                </div>
                <Badge variant={detailModal.request.status} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Type</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{detailModal.request.type || 'Standard Leave'}</p>
                </div>
                <div className="p-3 border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Duration</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{detailModal.request.duration || '—'}</p>
                </div>
              </div>

              {detailModal.request.reason && (
                <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1.5">Reason</p>
                  <p className="text-sm text-gray-600 italic">"{detailModal.request.reason}"</p>
                </div>
              )}

              <div className="flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-gray-400" />From: {new Date(detailModal.request.date).toLocaleDateString()}</span>
                {detailModal.request.endDate && <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-gray-400" />To: {new Date(detailModal.request.endDate).toLocaleDateString()}</span>}
              </div>

              {detailModal.request.status !== "Pending" && (
                <div className={`p-3 rounded-xl border ${detailModal.request.status === "Approved" ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {detailModal.request.status === "Approved"
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      : <XCircle className="w-3.5 h-3.5 text-red-600" />}
                    <span className={`text-xs font-semibold ${detailModal.request.status === "Approved" ? 'text-emerald-700' : 'text-red-700'}`}>
                      {detailModal.request.status}
                    </span>
                    {detailModal.request.approvedAt && <span className="text-xs text-gray-500 ml-auto">{new Date(detailModal.request.approvedAt).toLocaleString()}</span>}
                  </div>
                  {(detailModal.request.rejectionReason || detailModal.request.approverComments) && (
                    <p className="text-xs text-gray-600 italic ml-5">"{detailModal.request.rejectionReason || detailModal.request.approverComments}"</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
              {detailModal.request.status === "Pending" ? (
                <>
                  <button
                    onClick={() => { setDetailModal({ open: false, request: null }); openActionModal(detailModal.request!.id, 'reject', detailModal.request!.employee); }}
                    className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                  >Reject</button>
                  <button
                    onClick={() => { setDetailModal({ open: false, request: null }); openActionModal(detailModal.request!.id, 'approve', detailModal.request!.employee); }}
                    className="flex-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >Approve</button>
                </>
              ) : (
                <button onClick={() => setDetailModal({ open: false, request: null })} className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">Close</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Sub-components
function Badge({ variant }: { variant: string }) {
  const styles: Record<string, string> = {
    Approved: "bg-emerald-50 text-emerald-700 border border-emerald-100",
    Declined: "bg-red-50 text-red-700 border border-red-100",
    Pending: "bg-amber-50 text-amber-700 border border-amber-100",
  };
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${styles[variant] || styles.Pending}`}>
      {variant}
    </span>
  );
}

// Imports for icons
import {
  ClipboardCheck,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  X
} from "lucide-react";

