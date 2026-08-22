"use client";

/**
 * Shared create + edit form for kind='ad' campaigns (M11).
 *
 * Mirrors the company-side AnnouncementForm but adds:
 *  - advertiser company picker (autocomplete against /admin/companies)
 *  - payment fields: paid_amount_cents, paid_currency (ISO 4217), payment_notes
 *  - cross-company ad-targeting (company_ids allow-list, exclude_company_ids
 *    block-list, country_codes, roles)
 *  - mandatory "I've reviewed against the Ad Content Policy" checkbox before
 *    Create can fire — release-blocker dependency per the plan.
 *
 * Creative-change warning + version-snapshot semantics are identical to the
 * company-side form.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { AnnouncementStatus } from '../../../../../../services/announcements';
import type { AdCampaign, AdTargeting } from '../../../../../../services/ads';
import {
    createAdCampaign,
    patchAdCampaign,
    uploadAdImage,
} from '../../../../../../services/ads';
import SponsoredCardPreview from '../../../dashboard/announcements/components/SponsoredCardPreview';
import AdvertiserPicker from './AdvertiserPicker';
import CompanyMultiPicker from './CompanyMultiPicker';
import CrossCompanyDepartmentPicker from './CrossCompanyDepartmentPicker';

const CREATIVE_FIELDS = ['title', 'body', 'image_url', 'cta_label', 'cta_url'] as const;
type CreativeField = (typeof CREATIVE_FIELDS)[number];

// Currencies we accept — keep this list short; ops can extend when a new
// market signs an advertiser contract. ISO 4217, 3 chars.
const CURRENCIES = ['MUR', 'USD', 'EUR', 'ZAR', 'GBP', 'KES', 'NGN'] as const;

interface FormState {
    funding_company_id: number | null;
    funding_company_name: string;  // display only; not sent
    title: string;
    body: string;
    image_url: string;
    cta_label: string;
    cta_url: string;
    status: AnnouncementStatus;
    start_at: string;
    end_at: string;
    paid_amount: string;           // user enters major units; converted to cents on submit
    paid_currency: string;
    payment_notes: string;
    target_company_ids: number[];
    target_exclude_company_ids: number[];
    target_department_ids: number[];
    target_country_codes_csv: string;
    target_roles_csv: string;
    base_priority: string;
    variant_group: string;
    variant_label: string;
    policy_ack: boolean;           // not sent; gates the Create button
}

function emptyForm(): FormState {
    return {
        funding_company_id: null,
        funding_company_name: '',
        title: '',
        body: '',
        image_url: '',
        cta_label: '',
        cta_url: '',
        status: 'draft',
        start_at: '',
        end_at: '',
        paid_amount: '',
        paid_currency: 'MUR',
        payment_notes: '',
        target_company_ids: [],
        target_exclude_company_ids: [],
        target_department_ids: [],
        target_country_codes_csv: '',
        target_roles_csv: '',
        base_priority: '',
        variant_group: '',
        variant_label: '',
        policy_ack: false,
    };
}

// ISO UTC → local datetime-local input — same helper the company-side form
// uses (mirroring the timezone-correct roundtrip).
function isoToLocalInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
}

function fromAd(a: AdCampaign): FormState {
    const t = (a.targeting || {}) as AdTargeting;
    return {
        funding_company_id: a.funding_company_id,
        funding_company_name: '',
        title: a.title,
        body: a.body,
        image_url: a.image_url || '',
        cta_label: a.cta_label || '',
        cta_url: a.cta_url || '',
        status: a.status,
        start_at: isoToLocalInput(a.start_at),
        end_at: isoToLocalInput(a.end_at),
        paid_amount: a.paid_amount_cents != null ? (a.paid_amount_cents / 100).toFixed(2) : '',
        paid_currency: a.paid_currency || 'MUR',
        payment_notes: a.payment_notes || '',
        target_company_ids: t.company_ids || [],
        target_exclude_company_ids: t.exclude_company_ids || [],
        target_department_ids: t.department_ids || [],
        target_country_codes_csv: (t.country_codes || []).join(','),
        target_roles_csv: (t.roles || []).join(','),
        base_priority: a.base_priority != null ? String(a.base_priority) : '',
        variant_group: a.variant_group || '',
        variant_label: a.variant_label || '',
        // Editing existing record — admin already saw the row at creation.
        policy_ack: true,
    };
}

function parseCsvStrings(s: string): string[] | undefined {
    const trimmed = s.trim();
    if (!trimmed) return undefined;
    const out = trimmed.split(',').map((x) => x.trim()).filter(Boolean);
    return out.length ? out : undefined;
}

function buildTargeting(state: FormState): AdTargeting {
    const t: AdTargeting = {};
    if (state.target_company_ids.length) t.company_ids = state.target_company_ids;
    if (state.target_exclude_company_ids.length) {
        t.exclude_company_ids = state.target_exclude_company_ids;
    }
    if (state.target_department_ids.length) {
        t.department_ids = state.target_department_ids;
    }
    const countries = parseCsvStrings(state.target_country_codes_csv);
    if (countries) t.country_codes = countries.map((c) => c.toUpperCase());
    const roles = parseCsvStrings(state.target_roles_csv);
    if (roles) t.roles = roles;
    return t;
}

interface Props {
    mode: 'create' | 'edit';
    initial?: AdCampaign | null;
    onSaved: (a: AdCampaign) => void;
    onCancel?: () => void;
}

export default function AdCampaignForm({ mode, initial, onSaved, onCancel }: Props) {
    const [state, setState] = useState<FormState>(() =>
        initial ? fromAd(initial) : emptyForm(),
    );
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const initialRef = useRef<FormState | null>(initial ? fromAd(initial) : null);

    useEffect(() => {
        if (initial) {
            const next = fromAd(initial);
            setState(next);
            initialRef.current = next;
        }
    }, [initial]);

    const creativeChanged: CreativeField[] = useMemo(() => {
        if (mode !== 'edit' || !initialRef.current) return [];
        const start = initialRef.current;
        return CREATIVE_FIELDS.filter((f) => state[f] !== start[f]);
    }, [mode, state]);

    function update<K extends keyof FormState>(field: K, v: FormState[K]) {
        setState((s) => ({ ...s, [field]: v }));
    }

    async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast.error('Image must be 2 MB or smaller.');
            return;
        }
        setUploading(true);
        try {
            const { url } = await uploadAdImage(file);
            update('image_url', url);
            toast.success('Image uploaded.');
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const detail = (err as any)?.response?.data?.detail || 'Upload failed.';
            toast.error(detail);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!state.funding_company_id) {
            toast.error('Advertiser company is required.');
            return;
        }
        if (!state.title.trim() || !state.body.trim()) {
            toast.error('Title and body are required.');
            return;
        }
        if (state.cta_url && !state.cta_url.startsWith('https://')) {
            toast.error('CTA URL must start with https://.');
            return;
        }
        if (state.start_at && state.end_at) {
            const sMs = new Date(state.start_at).getTime();
            const eMs = new Date(state.end_at).getTime();
            if (eMs <= sMs) {
                toast.error('End must be after start.');
                return;
            }
        }
        const paidMajor = parseFloat(state.paid_amount);
        if (!Number.isFinite(paidMajor) || paidMajor <= 0) {
            toast.error('Paid amount must be greater than zero.');
            return;
        }
        if (mode === 'create' && !state.policy_ack) {
            toast.error('Ad Content Policy acknowledgement required.');
            return;
        }

        // Round to integer cents — avoids floating-point off-by-one (12.34 USD
        // can become 1234 cents but 1.005 should NOT become 100.5).
        const paidCents = Math.round(paidMajor * 100);
        const basePri = state.base_priority.trim()
            ? parseInt(state.base_priority.trim(), 10)
            : null;

        setSubmitting(true);
        try {
            if (mode === 'create') {
                let created = await createAdCampaign({
                    funding_company_id: state.funding_company_id,
                    title: state.title,
                    body: state.body,
                    image_url: state.image_url || null,
                    cta_label: state.cta_label || null,
                    cta_url: state.cta_url || null,
                    targeting: buildTargeting(state),
                    start_at: state.start_at ? new Date(state.start_at).toISOString() : null,
                    end_at: state.end_at ? new Date(state.end_at).toISOString() : null,
                    paid_amount_cents: paidCents,
                    paid_currency: state.paid_currency,
                    payment_notes: state.payment_notes || null,
                    base_priority: basePri,
                    variant_group: state.variant_group || null,
                    variant_label: state.variant_label || null,
                });
                // One-step publish if admin picked 'active' at create time.
                if (state.status !== 'draft') {
                    created = await patchAdCampaign(created.sponsored_content_id, {
                        status: state.status,
                    });
                }
                toast.success(
                    state.status === 'active'
                        ? 'Created and published.'
                        : `Created (status: ${state.status}).`,
                );
                onSaved(created);
            } else if (initial) {
                const patched = await patchAdCampaign(initial.sponsored_content_id, {
                    title: state.title,
                    body: state.body,
                    image_url: state.image_url || null,
                    cta_label: state.cta_label || null,
                    cta_url: state.cta_url || null,
                    status: state.status,
                    targeting: buildTargeting(state),
                    start_at: state.start_at ? new Date(state.start_at).toISOString() : null,
                    end_at: state.end_at ? new Date(state.end_at).toISOString() : null,
                    paid_amount_cents: paidCents,
                    paid_currency: state.paid_currency,
                    payment_notes: state.payment_notes || null,
                    base_priority: basePri,
                    variant_group: state.variant_group || null,
                    variant_label: state.variant_label || null,
                });
                toast.success(
                    creativeChanged.length
                        ? `Saved. New version created (${creativeChanged.join(', ')}).`
                        : 'Saved.',
                );
                onSaved(patched);
            }
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const detail = (err as any)?.response?.data?.detail || 'Save failed.';
            toast.error(typeof detail === 'string' ? detail : 'Save failed.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="space-y-4">
                <Field label="Advertiser" required>
                    <AdvertiserPicker
                        value={state.funding_company_id}
                        valueLabel={state.funding_company_name}
                        disabled={mode === 'edit'}  // can't change after create — billing is tied
                        onChange={(id, name) => {
                            update('funding_company_id', id);
                            update('funding_company_name', name);
                        }}
                    />
                    {mode === 'edit' && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                            Advertiser is locked after creation. Duplicate the campaign
                            to bill against a different company.
                        </p>
                    )}
                </Field>

                <Field label="Title" required>
                    <input
                        value={state.title}
                        onChange={(e) => update('title', e.target.value)}
                        maxLength={255}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                    />
                </Field>

                <Field label="Body" required>
                    <textarea
                        value={state.body}
                        onChange={(e) => update('body', e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                    />
                </Field>

                <Field label="Image">
                    <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-200">
                            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                            {uploading ? 'Uploading…' : state.image_url ? 'Replace' : 'Upload'}
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={handleImageUpload}
                                disabled={uploading}
                            />
                        </label>
                        {state.image_url && (
                            <>
                                <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[260px]" title={state.image_url}>
                                    {state.image_url.split('/').pop()}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => update('image_url', '')}
                                    className="text-xs text-red-500 dark:text-red-300 hover:underline"
                                >
                                    remove
                                </button>
                            </>
                        )}
                    </div>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">JPEG/PNG/WebP, ≤ 2 MB, ≤ 2000×2000 px.</p>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="CTA label">
                        <input
                            value={state.cta_label}
                            onChange={(e) => update('cta_label', e.target.value)}
                            maxLength={100}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                        />
                    </Field>
                    <Field label="CTA URL">
                        <input
                            value={state.cta_url}
                            onChange={(e) => update('cta_url', e.target.value)}
                            placeholder="https://…"
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                        />
                    </Field>
                </div>

                {/* Payment block */}
                <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Payment</p>
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Amount" required>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={state.paid_amount}
                                onChange={(e) => update('paid_amount', e.target.value)}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm bg-white dark:bg-zinc-900 tabular-nums"
                            />
                        </Field>
                        <Field label="Currency" required>
                            <select
                                value={state.paid_currency}
                                onChange={(e) => update('paid_currency', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm bg-white dark:bg-zinc-900"
                            >
                                {CURRENCIES.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Base priority">
                            <input
                                type="number"
                                value={state.base_priority}
                                onChange={(e) => update('base_priority', e.target.value)}
                                placeholder="50"
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm bg-white dark:bg-zinc-900 tabular-nums"
                            />
                        </Field>
                    </div>
                    <Field label="Payment notes (invoice ID, contract ref, etc.)">
                        <input
                            value={state.payment_notes}
                            onChange={(e) => update('payment_notes', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm bg-white dark:bg-zinc-900"
                        />
                    </Field>
                </div>

                <Field label="Status">
                    <select
                        value={state.status}
                        onChange={(e) => update('status', e.target.value as AnnouncementStatus)}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm bg-white dark:bg-zinc-900"
                    >
                        <option value="draft">draft — not visible</option>
                        <option value="active">active — eligible to serve</option>
                        <option value="paused">paused — keeps stats, hides from feed</option>
                        <option value="ended">ended — soft-deleted</option>
                    </select>
                    {mode === 'create' && state.status === 'active' && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1">
                            Will publish immediately on save. ENABLED_KINDS must include
                            &apos;ad&apos; in the deployment for ads to surface on /serve.
                        </p>
                    )}
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="Start at (optional)">
                        <input
                            type="datetime-local"
                            value={state.start_at}
                            onChange={(e) => update('start_at', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                        />
                    </Field>
                    <Field label="End at (optional)">
                        <input
                            type="datetime-local"
                            value={state.end_at}
                            onChange={(e) => update('end_at', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                        />
                    </Field>
                </div>

                <details className="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                    <summary className="text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer">
                        Targeting & A/B
                    </summary>
                    <div className="mt-3 space-y-3">
                        {/* Explainer for the default behavior — admins consistently
                            assumed the form REQUIRED an allow-list because the
                            picker is the first thing they see. Surfacing the
                            default up front removes that confusion. */}
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                            By default this ad serves to <strong>every eligible company</strong>.
                            Use the lists below to narrow the audience or exclude
                            specific companies.
                        </p>

                        <Field label="Allow-list — serve only to employees of these companies">
                            <CompanyMultiPicker
                                value={state.target_company_ids}
                                onChange={(ids) => update('target_company_ids', ids)}
                                placeholder="Search companies by name, BRN, or ID"
                            />
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                Leave empty to serve to <em>all</em> eligible companies.
                            </p>
                        </Field>
                        <Field label="Block-list — never serve to these (competitor conflict)">
                            <CompanyMultiPicker
                                value={state.target_exclude_company_ids}
                                onChange={(ids) => update('target_exclude_company_ids', ids)}
                                placeholder="Search companies to exclude"
                            />
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                Leave empty for no exclusions.
                            </p>
                        </Field>
                        <Field label="Specific departments within the allow-listed companies">
                            <CrossCompanyDepartmentPicker
                                companyIds={state.target_company_ids}
                                value={state.target_department_ids}
                                onChange={(ids) => update('target_department_ids', ids)}
                            />
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                Leave empty to target all departments of the
                                allow-listed companies.
                            </p>
                        </Field>
                        <Field label="Country codes (ISO 3166-1 alpha-2)">
                            <input
                                value={state.target_country_codes_csv}
                                onChange={(e) => update('target_country_codes_csv', e.target.value)}
                                placeholder="MU, MG"
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                            />
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                Leave empty to serve to all countries.
                            </p>
                        </Field>
                        <Field label="Roles (PrivateUser.role — employee, manager, admin, owner)">
                            <input
                                value={state.target_roles_csv}
                                onChange={(e) => update('target_roles_csv', e.target.value)}
                                placeholder="employee, manager"
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                            />
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                Leave empty to serve to all roles.
                            </p>
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Variant group (UUID)">
                                <input
                                    value={state.variant_group}
                                    onChange={(e) => update('variant_group', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                />
                            </Field>
                            <Field label="Variant label">
                                <input
                                    value={state.variant_label}
                                    onChange={(e) => update('variant_label', e.target.value)}
                                    placeholder="A / B"
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
                                />
                            </Field>
                        </div>

                        {/* Eligibility footnote — clarifies that this targeting
                            layer narrows further but cannot override the
                            ads_enabled master gate, which Kiruko controls
                            per-company on /admin/employers/[id]. Reduces the
                            "I targeted a company but they don't see the ad,
                            why?" support tickets. */}
                        <div className="mt-2 p-2.5 rounded-md bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                            <strong>What does &ldquo;eligible&rdquo; mean?</strong>{' '}
                            Kiruko controls per-company eligibility via the{' '}
                            <code className="text-[10px] bg-white dark:bg-zinc-900 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-800">ads_enabled</code>{' '}
                            toggle on the Employers admin page (
                            <a
                                href="/admin/employers"
                                className="text-emerald-700 dark:text-emerald-300 underline"
                            >
                                /admin/employers
                            </a>
                            ). This targeting layer narrows further; it
                            cannot override that gate.
                        </div>
                    </div>
                </details>

                {creativeChanged.length > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-900 text-xs">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <div>
                            <p className="font-semibold">Saving will create a new version.</p>
                            <p className="mt-0.5">
                                Changed: {creativeChanged.join(', ')}. Past impressions/clicks
                                stay attributed to the previous version.
                            </p>
                        </div>
                    </div>
                )}

                {mode === 'create' && (
                    // Release-blocker per plan: admin must affirm content policy
                    // review before paid ad ships. Link points at the doc once
                    // the policy is published — placeholder anchor in dev.
                    <label className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-zinc-900">
                        <input
                            type="checkbox"
                            checked={state.policy_ack}
                            onChange={(e) => update('policy_ack', e.target.checked)}
                            className="mt-0.5"
                        />
                        <span className="text-xs text-gray-700 dark:text-gray-300">
                            <ShieldCheck size={12} className="inline-block mr-1 -mt-0.5 text-emerald-600 dark:text-emerald-300" />
                            I have reviewed this ad against the{' '}
                            <a
                                href="/admin/policies/ad-content"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-700 dark:text-emerald-300 underline"
                            >
                                Ad Content Policy
                            </a>{' '}
                            (no loan, gambling, or medical-claim ads; no misleading
                            financial promises; no targeting of minors).
                        </span>
                    </label>
                )}

                <div className="flex items-center gap-2 pt-2">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="px-4 py-2 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60"
                    >
                        {submitting ? 'Saving…' : mode === 'create' ? 'Create campaign' : 'Save changes'}
                    </button>
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </div>

            {/* Live preview — explicitly kind='ad' so the orange Sponsored
                pill matches what mobile will render. */}
            <div className="xl:sticky xl:top-6 self-start">
                <SponsoredCardPreview
                    kind="ad"
                    fundingCompanyName={state.funding_company_name || 'Advertiser'}
                    title={state.title}
                    body={state.body}
                    imageUrl={state.image_url || null}
                    ctaLabel={state.cta_label || null}
                    ctaUrl={state.cta_url || null}
                />
            </div>
        </form>
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
