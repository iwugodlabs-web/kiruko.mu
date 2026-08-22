"use client";

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/services/apiClient';
import { Target, Edit3, Calendar, MapPin, Users, ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import DashboardHeader from '@/components/ui/DashboardHeader';
import SolarisBackground from '@/components/ui/SolarisBackground';

export default function TaskDetailPage() {
  const params = useParams() as { id?: string };
  const id = params?.id;
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const resp = await api.get(`/job/schedule/${id}`);
        if (!mounted) return;
        setTask(resp.data || null);
      } catch (err: unknown) {
        console.error('Failed to load task', err);
        setError('Failed to load task details');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [id]);

  const [actionLoadingComplete, setActionLoadingComplete] = useState(false);
  const [actionLoadingCancel, setActionLoadingCancel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoPreviousStatus, setUndoPreviousStatus] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const updateStatus = async (newStatus: 'completed' | 'cancelled') => {
    if (!id) return;
    const isCancel = newStatus === 'cancelled';
    if (isCancel) setActionLoadingCancel(true); else setActionLoadingComplete(true);
    setMessage(null);

    const previousTask = task ? { ...task } : null;
    const previousStatus = String(previousTask?.status ?? previousTask?.state ?? 'pending');
    setTask((t) => ({ ...(t || {}), status: newStatus } as Record<string, unknown>));

    if (newStatus === 'completed') {
      setUndoPreviousStatus(previousStatus);
      setUndoVisible(true);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => {
        setUndoVisible(false);
        undoTimer.current = null;
      }, 5000);
    }

    try {
      const payload = { status: newStatus };
      const resp = await api.put(`/job/schedule/${id}`, payload);
      setTask(resp.data || { ...(previousTask || {}), status: newStatus });
      setMessage(`Task marked ${newStatus}`);
      window.dispatchEvent(new Event('tasks:updated'));
    } catch (err) {
      console.error('Failed to update task status', err);
      setTask(previousTask);
      setMessage('Failed to update task');
      setUndoVisible(false);
      if (undoTimer.current) { window.clearTimeout(undoTimer.current); undoTimer.current = null; }
    } finally {
      if (isCancel) setActionLoadingCancel(false); else setActionLoadingComplete(false);
      setConfirmCancelOpen(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);

  const saveTitle = async () => {
    if (!id) return;
    setTitleSaving(true);
    try {
      await api.put(`/job/schedule/${id}`, { title: titleEditValue });
      setTask(t => ({ ...(t || {}), title: titleEditValue }));
      setTitleEditing(false);
      window.dispatchEvent(new Event('tasks:updated'));
    } catch (err) {
      console.error('Failed to save title', err);
      setMessage('Failed to save title');
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setTitleSaving(false);
    }
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return '—';
    try {
      const d = new Date(String(iso));
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  };

  const formatTime = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(String(iso));
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  useEffect(() => {
    setTitleEditValue(String(task?.title ?? task?.job_title ?? ''));
  }, [task?.title, task?.job_title]);

  const companyRaw = (task as Record<string, unknown>)?.company as Record<string, unknown> | undefined;
  const companyName = companyRaw ? String((companyRaw['company_name'] ?? companyRaw['company_id'] ?? '')) : '';
  const locationStr = String(task?.location ?? '');
  const assignedEmployees = (((task as Record<string, unknown>)?.assigned_employees as Array<Record<string, unknown>> | undefined) || []);
  const status = String(task?.status ?? task?.state ?? 'pending').toLowerCase();

  const statusConfig: Record<string, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <Clock size={16} />, label: 'Pending' },
    started: { bg: 'bg-blue-100', text: 'text-blue-700', icon: <Target size={16} />, label: 'In Progress' },
    completed: { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle size={16} />, label: 'Completed' },
    cancelled: { bg: 'bg-gray-100', text: 'text-gray-500', icon: <XCircle size={16} />, label: 'Cancelled' },
  };

  const currentStatus = statusConfig[status] || statusConfig.pending;

  if (loading) {
    return (
      <SolarisBackground>
        <div className="w-full max-w-7xl mx-auto py-8 px-6">
          <div className="animate-pulse space-y-6">
            <div className="h-8 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="h-32 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl" />
              <div className="h-32 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl" />
              <div className="h-32 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl" />
            </div>
          </div>
        </div>
      </SolarisBackground>
    );
  }

  if (error) {
    return (
      <SolarisBackground>
        <div className="w-full max-w-7xl mx-auto py-8 px-6">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-6">
            <ArrowLeft size={20} />
            Back to Tasks
          </button>
          <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400">
            {error}
          </div>
        </div>
      </SolarisBackground>
    );
  }

  return (
    <SolarisBackground>
    <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">
      <DashboardHeader
        title={String(task?.title ?? task?.job_title ?? `Task #${id}`)}
        subtitle={`Task details${companyName ? ` • ${companyName}` : ''}`}
        icon={Target}
        breadcrumbs={[
          { label: 'Tasks', href: '/dashboard/tasks' },
          { label: String(task?.title ?? task?.job_title ?? `Task #${id}`) },
        ]}
        back="/dashboard/tasks"
        extra={
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${currentStatus.bg} ${currentStatus.text}`}>
            {currentStatus.icon}
            <span className="font-medium text-sm">{currentStatus.label}</span>
          </div>
        }
      />

      {/* Title Edit Mode */}
      {titleEditing && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl">
          <label className="block text-sm font-medium text-gray-700 mb-2">Edit Task Title</label>
          <div className="flex items-center gap-3">
            <input
              className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900 transition-all"
              value={titleEditValue}
              onChange={(e) => setTitleEditValue(e.target.value)}
              placeholder="Enter task title"
              autoFocus
            />
            <button
              onClick={saveTitle}
              disabled={titleSaving}
              className="px-5 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {titleSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setTitleEditing(false); setTitleEditValue(String(task?.title ?? task?.job_title ?? '')); }}
              className="px-5 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="space-y-6">
        {/* Message Toast */}
        {message && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-700 flex items-center gap-2">
            <CheckCircle size={18} />
            {message}
          </div>
        )}

        {/* Undo Toast */}
        {undoVisible && (
          <div className="mb-6 p-4 bg-gray-900 rounded-xl text-white flex items-center justify-between">
            <span>Task marked as completed</span>
            <button
              onClick={async () => {
                if (!id || !undoPreviousStatus) return;
                setUndoVisible(false);
                try {
                  await api.put(`/job/schedule/${id}`, { status: undoPreviousStatus });
                  setTask(t => ({ ...(t || {}), status: undoPreviousStatus }));
                  window.dispatchEvent(new Event('tasks:updated'));
                } catch (err) {
                  console.error('Failed to undo status', err);
                  setMessage('Failed to undo');
                  setTimeout(() => setMessage(null), 3000);
                }
                if (undoTimer.current) { window.clearTimeout(undoTimer.current); undoTimer.current = null; }
              }}
              className="px-3 py-1 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
            >
              Undo
            </button>
          </div>
        )}

        {/* Quick Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Date & Time */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Calendar size={18} className="text-blue-600" />
              </div>
              <span className="font-medium text-gray-900">Schedule</span>
            </div>
            <div className="text-sm text-gray-600">
              <div className="flex justify-between py-1">
                <span>Start:</span>
                <span className="font-medium text-gray-900">
                  {formatDate(task?.start_time as string)} {formatTime(task?.start_time as string)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span>End:</span>
                <span className="font-medium text-gray-900">
                  {formatDate(task?.end_time as string)} {formatTime(task?.end_time as string)}
                </span>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <MapPin size={18} className="text-green-600" />
              </div>
              <span className="font-medium text-gray-900">Location</span>
            </div>
            <div className="text-sm text-gray-600">
              {locationStr || <span className="text-gray-400">No location set</span>}
            </div>
          </div>

          {/* Assignees Count */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-lg">
                <Users size={18} className="text-teal-600 dark:text-teal-400" />
              </div>
              <span className="font-medium text-gray-900 dark:text-gray-100">Assignees</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {assignedEmployees.length}
              <span className="text-sm font-normal text-gray-500 ml-1">
                {assignedEmployees.length === 1 ? 'person' : 'people'}
              </span>
            </div>
          </div>
        </div>

        {/* Assigned Employees */}
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Assigned Employees</h2>
          {assignedEmployees.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users className="mx-auto mb-2 text-gray-300" size={32} />
              <p>No employees assigned to this task</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {assignedEmployees.map(a => {
                const aRec = a as Record<string, unknown>;
                const privateUser = (aRec.private_user as Record<string, unknown>) || {};
                const empId = String(aRec.private_user_id ?? aRec.user_id ?? aRec.id ?? '');
                const firstName = String(aRec.first_name ?? privateUser.first_name ?? '');
                const lastName = String(aRec.last_name ?? privateUser.last_name ?? '');
                const name = `${firstName} ${lastName}`.trim() || `Employee #${empId}`;
                const initials = name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
                const email = String(aRec.email ?? privateUser.email ?? '');

                // #4 — proof photo this assignee attached on completion.
                const statuses = (task?.assignee_statuses as Array<Record<string, unknown>>) || [];
                const myStatus = statuses.find(s => String(s.private_user_id) === empId);
                const proofUrl = myStatus?.proof_image_url ? String(myStatus.proof_image_url) : '';

                return (
                  <div key={empId} className="p-3 bg-gray-50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-teal-500 text-white flex items-center justify-center font-semibold text-sm">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">{name}</div>
                        {email && <div className="text-xs text-gray-500 truncate">{email}</div>}
                      </div>
                    </div>
                    {proofUrl && (
                      <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proofUrl} alt={`Proof of completion by ${name}`} className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                        <span className="mt-1 inline-block text-xs font-medium text-teal-600">Photo proof — click to enlarge</span>
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Description */}
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Description</h2>
          <div className="text-gray-600">
            {String(task?.description ?? task?.notes ?? '') || (
              <span className="text-gray-400 italic">No description provided</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 mb-4">Actions</h2>
          <div className="flex flex-wrap gap-3">
            {status !== 'completed' && (
              <button
                onClick={() => updateStatus('completed')}
                disabled={actionLoadingComplete}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
              >
                {actionLoadingComplete ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Marking...
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    Mark Complete
                  </>
                )}
              </button>
            )}

            {status !== 'cancelled' && (
              <button
                onClick={() => setConfirmCancelOpen(true)}
                disabled={actionLoadingCancel}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl hover:bg-red-100 transition-colors font-medium disabled:opacity-50"
              >
                <XCircle size={18} />
                Cancel Task
              </button>
            )}

            <button
              onClick={() => setTitleEditing(true)}
              className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors font-medium"
            >
              <Edit3 size={18} />
              Edit Task
            </button>
          </div>
        </div>
      </div>

      {/* Confirm Cancel Modal */}
      {confirmCancelOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-100 rounded-full">
                <XCircle size={24} className="text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Cancel Task?</h3>
            </div>
            <p className="text-gray-600 mb-6">
              Are you sure you want to cancel this task? This action can be reverted later by changing the task status.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmCancelOpen(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors font-medium"
              >
                No, Keep It
              </button>
              <button
                onClick={() => updateStatus('cancelled')}
                disabled={actionLoadingCancel}
                className="px-5 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium disabled:opacity-50"
              >
                {actionLoadingCancel ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Cancelling...
                  </span>
                ) : 'Yes, Cancel Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </SolarisBackground>
  );
}
