"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { acceptInvite } from "@/services/api";

export default function InvitePage() {
  const [token, setToken] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // read token from URL when on client
    try {
      const p = new URLSearchParams(window.location.search);
      const t = p.get('token');
      setToken(t);
    } catch (e) {
      setToken(null);
    }
  }, []);

  type InvitePreview = { company_name?: string; role?: string; expires_at?: string; accepted?: boolean };
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);

  useEffect(() => {
    if (token === null) return; // wait until token is loaded from location
    if (!token) {
      setStatus('error');
      setMessage('No invite token provided.');
      return;
    }

    // fetch preview via API helper
    (async () => {
      try {
        const pr = await (await import('@/services/api')).getInvitePreview(token);
        if (pr && !(pr as unknown as { error?: string }).error) setPreview(pr as InvitePreview);
      } catch (e) {
        // ignore errors
      }
    })();

    // If user is logged in, auto-accept
    if (user) {
      (async () => {
        setStatus('loading');
        const res = await acceptInvite(token);
        const resObj = res as unknown as { error?: string };
        if (resObj.error) {
          setStatus('error');
          setMessage(resObj.error || 'Failed to accept invite');
        } else {
          setStatus('success');
          setMessage('Invite accepted. You have been added to the company.');
        }
      })();
    }
  }, [token, user]);

  if (!token) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold mb-2">Invalid Invitation</h2>
        <p className="text-gray-600">No invite token was provided in the URL.</p>
      </div>
    );
  }

  if (!user) {
    // Return the whole /invite?token=… path (single-encoded) so login can send
    // the user straight back here to auto-accept once signed in. Login lives at
    // "/" (there is no /login route).
    const returnPath = `/invite?token=${encodeURIComponent(token)}`;
    const loginUrl = `/?next=${encodeURIComponent(returnPath)}`;
    // Employees use the Kiruko mobile app, not this web dashboard — route them
    // to the app download on the marketing site instead of a web sign-in they
    // can't use. Everyone else (owner/admin/manager/member/viewer) is a web
    // dashboard user. Role comes from the preview; default to the web path
    // until it loads.
    const role = preview?.role?.trim().toLowerCase();
    const isEmployeeInvite = role === "employee";
    const MARKETING_DOWNLOAD_URL = "https://kiruko.mu/#download";
    return (
      <div className="p-8 max-w-xl">
        <h2 className="text-xl font-semibold mb-2">You&apos;re invited!</h2>
        {preview && (
          <div className="mb-3">
            <p className="text-gray-700"><strong>Company:</strong> {preview.company_name}</p>
            <p className="text-gray-700"><strong>Role:</strong> {preview.role}</p>
            {preview.expires_at && <p className="text-sm text-gray-500">Invite expires: {preview.expires_at}</p>}
          </div>
        )}
        {isEmployeeInvite ? (
          <>
            <p className="text-gray-600 mb-4">
              Kiruko for employees is a mobile app. Install it, then open this
              invitation link on your phone to join{preview?.company_name ? ` ${preview.company_name}` : " your company"}.
            </p>
            <div className="flex gap-3">
              <a href={MARKETING_DOWNLOAD_URL} className="px-4 py-2 bg-blue-600 text-white rounded">Download the app</a>
              <button onClick={() => navigator.clipboard.writeText(window.location.href)} className="px-4 py-2 bg-gray-100 rounded">Copy invite link</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-gray-600 mb-4">To accept the invitation, please sign in first.</p>
            <div className="flex gap-3">
              <a href={loginUrl} className="px-4 py-2 bg-blue-600 text-white rounded">Sign in</a>
              <button onClick={() => navigator.clipboard.writeText(window.location.href)} className="px-4 py-2 bg-gray-100 rounded">Copy invite link</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-xl">
      <h2 className="text-xl font-semibold mb-2">Invitation</h2>
      {preview && (
        <div className="mb-3">
          <p className="text-gray-700"><strong>Company:</strong> {preview.company_name}</p>
          <p className="text-gray-700"><strong>Role:</strong> {preview.role}</p>
          <p className="text-sm text-gray-500">Invite expires: {preview.expires_at}</p>
        </div>
      )}

      {status === 'loading' && <p className="text-gray-600">Processing…</p>}
      {status === 'success' && <p className="text-green-600">{message}</p>}
      {status === 'error' && <p className="text-red-600">{message}</p>}
      {status === 'idle' && <p className="text-gray-600">{preview ? "Ready to accept this invitation." : 'Preparing to accept the invite…'}</p>}

      <div className="mt-4 flex gap-3">
        {user && (
          <button
            onClick={async () => {
              setStatus('loading');
              const res = await acceptInvite(token);
              const resObj = res as unknown as { error?: string };
              if (resObj.error) {
                setStatus('error');
                setMessage(resObj.error || 'Failed to accept invite');
              } else {
                setStatus('success');
                setMessage('Invite accepted. You have been added to the company.');
              }
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Accept Invite
          </button>
        )}

        <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-gray-100 rounded">Go to dashboard</button>
        <button onClick={() => navigator.clipboard.writeText(window.location.href)} className="px-4 py-2 bg-gray-100 rounded">Copy invite link</button>
      </div>
    </div>
  );
}
