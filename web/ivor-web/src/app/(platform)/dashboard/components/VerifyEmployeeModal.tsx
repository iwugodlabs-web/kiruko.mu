"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle,
  XCircle,
  FileText,
  Shield,
  X,
  User,
  Briefcase,
  History as LucideHistory,
} from "lucide-react";
import { getUserDetail, setUserVerified } from "../../../../services/api";
import { api } from "../../../../services/apiClient";

type Props = {
  userId: number;
  isOpen: boolean;
  onClose: () => void;
  onResult?: (result: { action: 'approved' | 'rejected' | 'sent_back'; userId: number }) => void;
};

export default function VerifyEmployeeModal({ userId, isOpen, onClose, onResult }: Props) {
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [audits, setAudits] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      setLoading(true);
      const resp = await getUserDetail(userId);
      if (!('error' in resp)) {
        setUser(resp);
        // initialize checklist with common fields
        const privateUser = (resp as any).private_user;
        setChecklist({
          name: true,
          dob: !!privateUser?.date_of_birth,
          passport: !!privateUser?.pass_port_number,
          job_title: !!(privateUser?.jobs && privateUser.jobs.length),
          employer_brn: !!privateUser?.company_id || !!(privateUser?.jobs && privateUser.jobs.some((j: any) => j.employer_brn)),
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    };
    load();
    // fetch recent audits
    (async () => {
      try {
        const res = await api.get(`/user/${userId}/verification-audit`);
        const payload = res.data?.data ?? res.data ?? [];
        setAudits(Array.isArray(payload) ? payload : []);
      } catch (e) {
        console.debug('Failed to fetch audits', e);
        setAudits([]);
      }
    })();
  }, [isOpen, userId]);

  const toggle = (k: string) => setChecklist(prev => ({ ...prev, [k]: !prev[k] }));

  const handleApprove = async () => {
    setProcessing(true);
    try {
      // Single atomic endpoint — sets status, verified, links company_id and jobs in one transaction
      await api.post(`/user/${userId}/approve`, { checklist, note });
      onResult && onResult({ action: 'approved', userId });
      onClose();
    } catch (e) {
      console.error('Approve failed', e);
      alert('Failed to approve.');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    setProcessing(true);
    try {
      await api.patch(`/user/${userId}`, { company_onboarding_status: 'rejected' });
      await setUserVerified(userId, false);
      try {
        await api.post(`/user/${userId}/verification-audit`, { action: 'rejected', checklist, note });
      } catch (e) {
        console.debug('Audit failed', e);
      }
      onResult && onResult({ action: 'rejected', userId });
      onClose();
    } catch (e) {
      console.error('Reject failed', e);
      alert('Failed to reject.');
    } finally {
      setProcessing(false);
    }
  };

  const handleSendBack = async () => {
    setProcessing(true);
    try {
      await api.patch(`/user/${userId}`, { company_onboarding_status: 'pending', verification_note: note });
      try {
        await api.post(`/user/${userId}/verification-audit`, { action: 'sent_back', checklist, note });
      } catch (e) {
        console.debug('Audit failed', e);
      }
      onResult && onResult({ action: 'sent_back', userId });
      onClose();
    } catch (e) {
      console.error('Send back failed', e);
      alert('Failed to send back.');
    } finally {
      setProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={() => onClose()} />

      <div className="relative w-full max-w-4xl bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden border border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-300">
              <Shield size={16} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Employee Review</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">Verify credentials and approve or reject</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-6 h-6 border-2 border-gray-200 dark:border-gray-700 border-t-gray-800 dark:border-t-gray-200 rounded-full animate-spin" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Loading employee details...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Record Details */}
              <div className="space-y-6 border-r border-gray-200 dark:border-gray-800 pr-8">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-gray-400 dark:text-gray-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Identity</span>
                  </div>
                  <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Full Name</label>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{user ? `${user.private_user?.first_name || ''} ${user.private_user?.last_name || ''}` : '—'}</div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Date of Birth</label>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{user?.private_user?.date_of_birth || '—'}</div>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Passport / National ID</label>
                      <div className="text-sm font-mono font-medium text-gray-900 dark:text-white">{user?.private_user?.pass_port_number || '—'}</div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Briefcase size={14} className="text-gray-400 dark:text-gray-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Employment</span>
                  </div>
                  <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Job Title</label>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{user?.private_user?.jobs?.[0]?.job_title || '—'}</div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">BRN / Company ID</label>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{user?.private_user?.jobs?.[0]?.employer_brn || user?.private_user?.company_id || '—'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 dark:text-gray-500">
                      <FileText size={15} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{user?.private_user?.attachments?.length || 0} documents attached</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">Supporting evidence files</div>
                    </div>
                  </div>
                </section>
              </div>

              {/* Verification Controls */}
              <div className="space-y-6">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-gray-400 dark:text-gray-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Verification Checklist</span>
                  </div>
                  <div className="space-y-2">
                    {Object.keys(checklist).map((k) => (
                      <label key={k} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 hover:bg-white dark:hover:bg-gray-800/70 rounded-lg border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 cursor-pointer transition-all group">
                        <div className="relative flex items-center">
                          <input
                            type="checkbox"
                            checked={!!checklist[k]}
                            onChange={() => toggle(k)}
                            className="w-4 h-4 rounded border-gray-200 text-gray-900 focus:ring-gray-400 transition-all cursor-pointer opacity-0 absolute inset-0 z-10"
                          />
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                            checklist[k] ? 'bg-gray-900 border-gray-900 dark:bg-gray-100 dark:border-gray-100' : 'border-gray-300 dark:border-gray-600 group-hover:border-gray-400 dark:group-hover:border-gray-500 bg-white dark:bg-gray-900'
                          }`}>
                            {checklist[k] && <CheckCircle size={10} className="text-white dark:text-gray-900" />}
                          </div>
                        </div>
                        <span className={`text-xs font-medium capitalize ${
                          checklist[k] ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {k.replace('_', ' ')}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Review Notes</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:text-white focus:outline-none focus:border-gray-400 transition-colors placeholder:text-gray-300 dark:placeholder-gray-600"
                    rows={4}
                    placeholder="Add notes about this review..."
                  />
                </section>
              </div>
            </div>
          )}
        </div>

        {/* Audit History */}
        {audits.length > 0 && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 mb-3">
              <LucideHistory size={14} className="text-gray-400 dark:text-gray-500" />
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Review History</span>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {audits.map((a, i) => (
                <div key={i} className="flex items-start justify-between p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-md border ${
                        a.action === 'approved' ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300' :
                        a.action === 'rejected' ? 'bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900/50 text-red-700 dark:text-red-300' :
                        'bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/50 text-amber-700 dark:text-amber-300'
                      }`}>
                        {a.action}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">by {a.actor_user_id || 'System'}</span>
                    </div>
                    {a.details && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        {typeof a.details === 'string' ? a.details : JSON.stringify(a.details)}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-4">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSendBack}
              disabled={processing}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-100 dark:border-amber-900/50 transition-colors disabled:opacity-50"
            >
              Send for Revision
            </button>
            <button
              onClick={handleReject}
              disabled={processing}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-100 dark:border-red-900/50 transition-colors disabled:opacity-50"
            >
              Reject
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={processing}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-gray-900 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {processing && (
                <div className="w-4 h-4 border-2 border-white/30 dark:border-gray-900/30 border-t-white dark:border-t-gray-900 rounded-full animate-spin" />
              )}
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
