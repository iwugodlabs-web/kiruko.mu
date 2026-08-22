"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { getUsersByCompany, inviteCompanyUser, transferCompanyOwnership, disableCompanyUser } from "../../../../services/api";
import InviteUserModal from "./InviteUserModal";
import TransferOwnershipModal from "./TransferOwnershipModal";

type Props = { companyId: number };

export default function CompanyUsersSection({ companyId }: Props) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await getUsersByCompany(companyId);
        if ((res as any)?.error) {
          setUsers([]);
        } else {
          setUsers(res as any);
        }
      } catch (error) {
        console.error('Failed to load company users:', error);
        setUsers([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false };
  }, [companyId]);

  const handleInvite = async (email: string, role: string) => {
    await inviteCompanyUser(companyId, { email, role });
    setShowInvite(false);
    // refresh
    const res = await getUsersByCompany(companyId);
    if (!(res as any)?.error) setUsers(res as any);
  };

  const handleTransfer = async (newOwnerId: number) => {
    await transferCompanyOwnership(companyId, { new_owner_user_id: newOwnerId });
    setShowTransfer(false);
    // refresh
    const res = await getUsersByCompany(companyId);
    if (!(res as any)?.error) setUsers(res as any);
  };

  const handleRemove = async (userId: number) => {
    await disableCompanyUser(userId, { enabled: false });
    // refresh
    const res = await getUsersByCompany(companyId);
    if (!(res as any)?.error) setUsers(res as any);
  };

  return (
    <div className="p-4 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-lg font-semibold">Company Users</h4>
        <div className="flex gap-2">
          <button onClick={() => setShowInvite(true)} className="px-3 py-1 bg-blue-500 text-white rounded">Invite</button>
        </div>
      </div>
      {loading ? (
        <div>Loading…</div>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.user_id} className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">{u.private_user?.first_name} {u.private_user?.last_name} {u.private_user?.role === 'owner' && <span className="ml-2 text-xs bg-yellow-200 rounded px-2">Owner</span>}</div>
                <div className="text-sm text-gray-500">{u.email}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleRemove(u.user_id)} className="text-sm text-red-600">Remove</button>
                <button onClick={() => setShowTransfer(true)} className="text-sm text-blue-600">Transfer as Owner</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showInvite && <InviteUserModal isOpen={showInvite} onClose={() => setShowInvite(false)} onInvite={handleInvite} />}
      {showTransfer && <TransferOwnershipModal users={users} onClose={() => setShowTransfer(false)} onTransfer={handleTransfer} />}
    </div>
  );
}
