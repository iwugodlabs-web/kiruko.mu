"use client";

/**
 * Catch the silent "active but not serving" trap.
 *
 * `status='active'` alone doesn't guarantee `/serve` returns the row — the
 * serve query also enforces `start_at <= now() <= COALESCE(end_at, now())`.
 * An admin who picks a future start_at in the form (easy mistake — the
 * picker defaults to the next round hour) sees an Active status pill on
 * the detail page and assumes the card is live, while the mobile silently
 * filters it out.
 *
 * This banner inspects start_at + end_at against `now()` and surfaces the
 * window state explicitly. Shared between the company-side announcement
 * detail page and the platform-admin ad detail page — same trap on both.
 */

import { AlertCircle, Clock, CheckCircle2 } from 'lucide-react';

interface Props {
    status: string;
    startAt: string | null | undefined;
    endAt: string | null | undefined;
}

function formatRelative(ms: number): string {
    const abs = Math.abs(ms);
    const mins = Math.round(abs / 60_000);
    if (mins < 1) return 'less than a minute';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
}

export default function ServingWindowBanner({ status, startAt, endAt }: Props) {
    // Skip the banner for draft / paused / ended — those have their own
    // signaling via the status field. We only catch the "active but
    // outside its window" case.
    if (status !== 'active') return null;

    const now = Date.now();
    const startMs = startAt ? new Date(startAt).getTime() : null;
    const endMs = endAt ? new Date(endAt).getTime() : null;

    if (startMs !== null && startMs > now) {
        return (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs mb-4">
                <Clock size={14} className="mt-0.5 shrink-0" />
                <div>
                    <p className="font-semibold">Scheduled — not serving yet.</p>
                    <p className="mt-0.5">
                        Status is <strong>active</strong>, but the serve window opens in{' '}
                        <strong>{formatRelative(startMs - now)}</strong> ({new Date(startAt!).toLocaleString()}).
                        Employees won&apos;t see this card on their home screen until then.
                        Clear or backdate <em>Start at</em> below to publish immediately.
                    </p>
                </div>
            </div>
        );
    }

    if (endMs !== null && endMs < now) {
        return (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 text-xs mb-4">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <div>
                    <p className="font-semibold">Window closed — no longer serving.</p>
                    <p className="mt-0.5">
                        Status is <strong>active</strong>, but <em>End at</em> was{' '}
                        <strong>{formatRelative(now - endMs)} ago</strong>{' '}
                        ({new Date(endAt!).toLocaleString()}).
                        Extend it below or change status to <strong>ended</strong>.
                    </p>
                </div>
            </div>
        );
    }

    // Active AND currently serving.
    return (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs mb-4">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <div>
                <p className="font-semibold">Live — eligible to serve right now.</p>
                <p className="mt-0.5">
                    {endMs === null
                        ? 'No end date set — serves until paused or ended.'
                        : `Window closes in ${formatRelative(endMs - now)} (${new Date(endAt!).toLocaleString()}).`}
                </p>
            </div>
        </div>
    );
}
