"use client";

/**
 * Platform-admin page for Kiruko house announcements.
 *
 * House content is the inventory backstop: when no paid ad or employer
 * announcement is eligible for a slot, the serve algorithm picks a random
 * house row. Used to promote platform features ("Try the new calculator")
 * and keep the surface active even on quiet days.
 *
 * Schema-wise these rows live in `sponsored_content` with `kind='house'`,
 * `funding_company_id=NULL`, `paid_amount_cents=NULL`. The backend's
 * POST /admin/ads/house enforces those invariants.
 */

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Plus, Loader2, Upload, X, AlertCircle, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import RoleGuard from '../../../components/RoleGuard';
import SponsoredCardPreview from '../../../dashboard/announcements/components/SponsoredCardPreview';
import StatsPanel from '../components/StatsPanel';
import {
    createHouseAnnouncement,
    deleteSponsored,
    getSponsoredStats,
    listSponsoredModeration,
    patchSponsored,
} from '../../../../../../services/sponsored-admin';
import type {
    Announcement,
    AnnouncementStats,
    AnnouncementStatus,
} from '../../../../../../services/announcements';
// Platform-admin upload endpoint — doesn't require the caller to be a
// company admin, so a pure platform-admin (Kiruko ops staff with no
// company affiliation) can upload house creatives.
import { uploadAdImage } from '../../../../../../services/ads';

interface HouseFormState {
    title: string;
    body: string;
    image_url: string;
    cta_label: string;
    cta_url: string;
    country_codes_csv: string;
    start_at: string;
    end_at: string;
    // When set, the SponsoredCard renders "from {advertiser_name}"
    // instead of the "from Kiruko" fallback. Used for contextual
    // house slots sold to external advertisers (e.g. "Spar").
    external_advertiser_name: string;
}

const emptyForm = (): HouseFormState => ({
    title: '',
    body: '',
    image_url: '',
    cta_label: '',
    cta_url: '',
    country_codes_csv: '',
    start_at: '',
    end_at: '',
    external_advertiser_name: '',
});

function HouseAdminContent() {
    const [rows, setRows] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<HouseFormState>(emptyForm);
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    // null = creating a new house row; number = editing the row with that id.
    // Only allowed for status='draft' rows — once a house card is published
    // (active/paused/ended), it's locked. Adjust the gate in the row's
    // Edit-button conditional if you ever want to allow post-publish edits.
    const [editingId, setEditingId] = useState<number | null>(null);
    // Per-row stats cache: row id → fetched stats (or `null` while loading).
    // A missing entry means "stats not requested yet"; a `null` entry means
    // "request in-flight"; an object means "loaded". Memo-keyed by id so
    // re-rendering the table doesn't re-fire requests for already-loaded rows.
    const [statsById, setStatsById] = useState<Record<number, AnnouncementStats | null>>({});
    const [openStatsId, setOpenStatsId] = useState<number | null>(null);

    async function toggleStats(id: number) {
        if (openStatsId === id) {
            setOpenStatsId(null);
            return;
        }
        setOpenStatsId(id);
        if (id in statsById) return; // already fetched or in-flight
        setStatsById((prev) => ({ ...prev, [id]: null }));
        try {
            const s = await getSponsoredStats(id, 'day');
            setStatsById((prev) => ({ ...prev, [id]: s }));
        } catch {
            // Leave the cached null so the panel shows "No stats yet" rather
            // than spinning forever. A retry happens on the next toggle.
            toast.error('Failed to load stats.');
        }
    }

    function startEdit(row: Announcement) {
        const targeting = (row.targeting ?? {}) as { country_codes?: string[] };
        setForm({
            title: row.title ?? '',
            body: row.body ?? '',
            image_url: row.image_url ?? '',
            cta_label: row.cta_label ?? '',
            cta_url: row.cta_url ?? '',
            country_codes_csv: (targeting.country_codes ?? []).join(', '),
            // <input type="datetime-local"> needs a trailing-Z-free local
            // string. Slice off any timezone suffix the API returned.
            start_at: row.start_at ? new Date(row.start_at).toISOString().slice(0, 16) : '',
            end_at: row.end_at ? new Date(row.end_at).toISOString().slice(0, 16) : '',
            external_advertiser_name:
                (row as { external_advertiser_name?: string | null }).external_advertiser_name ?? '',
        });
        setEditingId(row.sponsored_content_id);
        setShowForm(true);
        // Scroll back to the top so the form is visible.
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function cancelEdit() {
        setEditingId(null);
        setForm(emptyForm());
        setShowForm(false);
    }

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listSponsoredModeration({ kind: 'house', limit: 100 });
            setRows(data);
        } catch {
            toast.error('Failed to load house announcements.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast.error('Image must be ≤ 2 MB.');
            return;
        }
        setUploading(true);
        try {
            // Platform-admin upload — `/admin/ads/upload-image` is the
            // platform-gated endpoint added in M11. Doesn't require the
            // caller to also be a company admin, so this works for pure
            // Kiruko ops staff. Files land under `sponsored/ad/staging/{user_id}`
            // server-side.
            const { url } = await uploadAdImage(file);
            setForm((f) => ({ ...f, image_url: url }));
            toast.success('Image uploaded.');
        } catch (err) {
            const detail =
                (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                'Upload failed.';
            toast.error(detail);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!form.title.trim() || !form.body.trim()) {
            toast.error('Title and body are required.');
            return;
        }
        if (form.cta_url && !form.cta_url.startsWith('https://')) {
            toast.error('CTA URL must be https://.');
            return;
        }
        setSubmitting(true);
        try {
            const country_codes = form.country_codes_csv
                .split(',')
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean);
            const targeting = country_codes.length ? { country_codes } : {};
            const start_at = form.start_at ? new Date(form.start_at).toISOString() : null;
            const end_at = form.end_at ? new Date(form.end_at).toISOString() : null;

            const external_advertiser_name = form.external_advertiser_name.trim() || null;
            if (editingId != null) {
                // Edit-in-place via cross-kind admin patch endpoint.
                // patch_sponsored_content auto-snapshots a new version
                // when any creative field changes, so the version
                // history on this row stays accurate.
                await patchSponsored(editingId, {
                    title: form.title,
                    body: form.body,
                    image_url: form.image_url || null,
                    cta_label: form.cta_label || null,
                    cta_url: form.cta_url || null,
                    targeting,
                    start_at,
                    end_at,
                    external_advertiser_name,
                });
                toast.success('House announcement updated.');
            } else {
                await createHouseAnnouncement({
                    title: form.title,
                    body: form.body,
                    image_url: form.image_url || null,
                    cta_label: form.cta_label || null,
                    cta_url: form.cta_url || null,
                    targeting,
                    start_at,
                    end_at,
                    external_advertiser_name,
                });
                toast.success('House announcement created (status=draft).');
            }
            setForm(emptyForm());
            setEditingId(null);
            setShowForm(false);
            load();
        } catch (err) {
            const detail =
                (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                (editingId != null ? 'Update failed.' : 'Create failed.');
            toast.error(typeof detail === 'string' ? detail : 'Save failed.');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleEnd(id: number) {
        if (!confirm('End this house announcement?')) return;
        try {
            await deleteSponsored(id);  // cross-kind admin endpoint
            toast.success('Ended.');
            load();
        } catch {
            toast.error('Delete failed.');
        }
    }

    async function handleStatusChange(id: number, status: AnnouncementStatus) {
        try {
            await patchSponsored(id, { status });
            toast.success(`Status: ${status}.`);
            load();
        } catch {
            toast.error('Status change failed.');
        }
    }

    return (
        <div className="w-full py-8 px-6">
            <div className="flex items-center justify-between mb-6 pb-5 border-b border-gray-200 dark:border-gray-800">
                <div>
                    <h1 className="flex items-center gap-2 text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">
                        <Sparkles size={20} className="text-gray-400 dark:text-gray-500" />
                        House announcements
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Kiruko-wide content served when no paid ad or employer
                        announcement fills the slot.
                    </p>
                </div>
                <button
                    onClick={() => {
                        if (showForm) {
                            cancelEdit();
                        } else {
                            setForm(emptyForm());
                            setEditingId(null);
                            setShowForm(true);
                        }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                >
                    {showForm ? (
                        <>
                            <X size={14} /> {editingId != null ? 'Cancel edit' : 'Close'}
                        </>
                    ) : (
                        <>
                            <Plus size={14} /> New
                        </>
                    )}
                </button>
            </div>

            {showForm && (
                <div className="mb-8 p-5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-zinc-900">
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <Field label="Title" required>
                                <input
                                    value={form.title}
                                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                />
                            </Field>
                            <Field label="Body" required>
                                <textarea
                                    value={form.body}
                                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                                    rows={4}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                />
                            </Field>
                            <Field label="Image">
                                <div className="flex items-center gap-3">
                                    <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-200">
                                        {uploading ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Upload size={14} />
                                        )}
                                        {uploading ? 'Uploading…' : form.image_url ? 'Replace' : 'Upload'}
                                        <input
                                            type="file"
                                            accept="image/png,image/jpeg,image/webp"
                                            className="hidden"
                                            onChange={handleImage}
                                            disabled={uploading}
                                        />
                                    </label>
                                    {form.image_url && (
                                        <button
                                            type="button"
                                            onClick={() => setForm({ ...form, image_url: '' })}
                                            className="text-xs text-red-500 dark:text-red-300 hover:underline"
                                        >
                                            remove
                                        </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                    JPEG/PNG/WebP, ≤ 2 MB, ≤ 2000×2000 px.
                                </p>
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="CTA label">
                                    <input
                                        value={form.cta_label}
                                        onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                    />
                                </Field>
                                <Field label="CTA URL">
                                    <input
                                        value={form.cta_url}
                                        onChange={(e) => setForm({ ...form, cta_url: e.target.value })}
                                        placeholder="https://…"
                                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                    />
                                </Field>
                            </div>
                            <Field label="Advertiser name (optional — leave blank for Kiruko first-party)">
                                <input
                                    value={form.external_advertiser_name}
                                    onChange={(e) =>
                                        setForm({ ...form, external_advertiser_name: e.target.value })
                                    }
                                    placeholder="Spar, MCB Juice, …"
                                    maxLength={255}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                />
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                    Renders as &ldquo;from {form.external_advertiser_name || 'Kiruko'}&rdquo; on the card.
                                </p>
                            </Field>
                            <Field label="Country codes (CSV, empty = all)">
                                <input
                                    value={form.country_codes_csv}
                                    onChange={(e) => setForm({ ...form, country_codes_csv: e.target.value })}
                                    placeholder="MU,MG"
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Start at">
                                    <input
                                        type="datetime-local"
                                        value={form.start_at}
                                        onChange={(e) => setForm({ ...form, start_at: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                    />
                                </Field>
                                <Field label="End at">
                                    <input
                                        type="datetime-local"
                                        value={form.end_at}
                                        onChange={(e) => setForm({ ...form, end_at: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                    />
                                </Field>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-4 py-2 text-sm font-semibold text-white bg-gray-900 rounded-lg disabled:opacity-60"
                                >
                                    {submitting
                                        ? (editingId != null ? 'Saving…' : 'Creating…')
                                        : (editingId != null ? 'Save changes' : 'Create')}
                                </button>
                                <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                    <AlertCircle size={11} />
                                    Will be created as <strong className="mx-0.5">draft</strong>. Flip
                                    status to <strong className="mx-0.5">active</strong> from the
                                    company-side detail page once ready (Phase 1 limitation).
                                </p>
                            </div>
                        </div>
                        <div className="xl:sticky xl:top-6 self-start">
                            <SponsoredCardPreview
                                kind="house"
                                externalAdvertiserName={form.external_advertiser_name || null}
                                title={form.title}
                                body={form.body}
                                imageUrl={form.image_url || null}
                                ctaLabel={form.cta_label || null}
                                ctaUrl={form.cta_url || null}
                            />
                        </div>
                    </form>
                </div>
            )}

            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="text-left px-4 py-2 font-semibold">Title</th>
                            <th className="text-left px-4 py-2 font-semibold">Status</th>
                            <th className="text-right px-4 py-2 font-semibold">Views</th>
                            <th className="text-right px-4 py-2 font-semibold">Clicks</th>
                            <th className="text-left px-4 py-2 font-semibold">Created</th>
                            <th className="px-4 py-2 w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && rows.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                                    No house announcements yet.
                                </td>
                            </tr>
                        )}
                        {!loading &&
                            rows.flatMap((a) => [
                                <tr key={a.sponsored_content_id} className="border-t border-gray-100 dark:border-gray-800">
                                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{a.title}</td>
                                    <td className="px-4 py-2.5">
                                        {/* Inline status selector — primary way to publish
                                            a house draft, since house rows don't have a
                                            dedicated detail/edit page. */}
                                        <select
                                            value={a.status}
                                            onChange={(e) =>
                                                handleStatusChange(
                                                    a.sponsored_content_id,
                                                    e.target.value as AnnouncementStatus,
                                                )
                                            }
                                            disabled={a.status === 'ended'}
                                            className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-md border ${
                                                a.status === 'active'
                                                    ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                                    : a.status === 'paused'
                                                    ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30'
                                                    : a.status === 'ended'
                                                    ? 'bg-gray-50 dark:bg-gray-900/40 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-800'
                                                    : 'bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-800'
                                            }`}
                                        >
                                            <option value="draft">draft</option>
                                            <option value="active">active</option>
                                            <option value="paused">paused</option>
                                            <option value="ended">ended</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{a.view_count}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{a.click_count}</td>
                                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">
                                        {new Date(a.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                        {/* Edit allowed in all states except
                                            soft-deleted ('ended' rows are still
                                            editable in case an admin needs to
                                            revive one). patch_sponsored_content
                                            auto-snapshots a new version on any
                                            creative-field change, so the
                                            version history stays accurate even
                                            when admins fix a typo post-publish. */}
                                        <button
                                            onClick={() => toggleStats(a.sponsored_content_id)}
                                            className={`text-xs mr-3 inline-flex items-center gap-1 ${
                                                openStatsId === a.sponsored_content_id
                                                    ? 'text-gray-900 dark:text-gray-100'
                                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900'
                                            }`}
                                            title="Stats: views / clicks / dismissals over time"
                                        >
                                            <BarChart2 size={12} />
                                            Stats
                                        </button>
                                        <button
                                            onClick={() => startEdit(a)}
                                            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 text-xs mr-3"
                                            title={a.status === 'draft' ? 'Edit draft' : 'Edit creative (auto-versioned)'}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleEnd(a.sponsored_content_id)}
                                            className="text-gray-400 dark:text-gray-500 hover:text-red-500 text-xs"
                                            title="End (soft delete)"
                                        >
                                            End
                                        </button>
                                    </td>
                                </tr>,
                                openStatsId === a.sponsored_content_id ? (
                                    <tr key={`${a.sponsored_content_id}-stats`} className="border-t border-gray-50 bg-gray-50/50">
                                        <td colSpan={6} className="px-4 py-4">
                                            {statsById[a.sponsored_content_id] === null ? (
                                                <div className="text-sm text-gray-400 dark:text-gray-500 inline-flex items-center gap-2">
                                                    <Loader2 size={14} className="animate-spin" />
                                                    Loading stats…
                                                </div>
                                            ) : (
                                                <StatsPanel stats={statsById[a.sponsored_content_id] ?? null} />
                                            )}
                                        </td>
                                    </tr>
                                ) : null,
                            ])}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Field({
    label,
    required,
    children,
}: {
    label: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">
                {label}
                {required && <span className="text-red-500 dark:text-red-300 ml-0.5">*</span>}
            </span>
            {children}
        </label>
    );
}

export default function HouseAdminPage() {
    return (
        <RoleGuard requiredRole={['platform_admin']}>
            <HouseAdminContent />
        </RoleGuard>
    );
}
