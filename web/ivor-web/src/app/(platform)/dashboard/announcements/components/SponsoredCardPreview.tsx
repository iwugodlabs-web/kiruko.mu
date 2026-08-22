"use client";

/**
 * Mobile-shaped preview of the SponsoredCard that the React Native app will
 * render. 320px-wide phone frame so what designers see in the admin panel
 * matches what employees see in production.
 *
 * Intentionally NOT a pixel-perfect reproduction of the RN component —
 * different design systems. Goal is "would the headline read well at phone
 * width, does the image crop reasonably, does the CTA wrap." Close enough
 * for the admin to catch obviously broken creatives before saving.
 */
import { X } from 'lucide-react';
import type { AnnouncementKind } from '../../../../../../services/announcements';

interface Props {
    kind: AnnouncementKind;
    fundingCompanyName?: string;
    /** kind='house' only — overrides the "From Kiruko" fallback when the
     *  slot was sold to an external advertiser (Spar, MCB Juice, …). */
    externalAdvertiserName?: string | null;
    title: string;
    body: string;
    imageUrl?: string | null;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
}

function sourceLabel(
    kind: AnnouncementKind,
    companyName?: string,
    externalAdvertiserName?: string | null,
): string {
    if (kind === 'employer') return companyName ? `From ${companyName}` : 'From your employer';
    if (kind === 'ad') return `From ${companyName || 'Advertiser'}`;
    return externalAdvertiserName ? `From ${externalAdvertiserName}` : 'From Kiruko';
}

// Kind-aware type pill + edge stripe. Mirrors the mobile SponsoredCard so
// admins preview what employees actually see. Tailwind class strings are
// inlined here (no design-token indirection) so this stays a single
// self-contained component.
function variantFor(kind: AnnouncementKind, externalAdvertiserName?: string | null) {
    if (kind === 'ad') {
        return {
            pillLabel: 'SPONSORED',
            pillClass: 'bg-amber-100 text-amber-700',
            stripeClass: 'bg-amber-500',
        };
    }
    if (kind === 'employer') {
        return {
            pillLabel: 'ANNOUNCEMENT',
            pillClass: 'bg-indigo-100 text-indigo-700',
            stripeClass: 'bg-indigo-500',
        };
    }
    // kind === 'house'
    if (externalAdvertiserName) {
        return {
            pillLabel: 'PROMOTED',
            pillClass: 'bg-slate-200 text-slate-700',
            stripeClass: 'bg-slate-500',
        };
    }
    return {
        pillLabel: null as string | null,
        pillClass: '',
        stripeClass: 'bg-emerald-500',
    };
}

export default function SponsoredCardPreview({
    kind,
    fundingCompanyName,
    externalAdvertiserName,
    title,
    body,
    imageUrl,
    ctaLabel,
    ctaUrl,
}: Props) {
    const variant = variantFor(kind, externalAdvertiserName);
    return (
        <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Mobile preview</p>
            {/* Phone-shaped frame */}
            <div className="w-[320px] rounded-[28px] border-[10px] border-gray-900 bg-gray-50 shadow-lg overflow-hidden">
                <div className="h-6 bg-gray-900 flex items-center justify-center">
                    <div className="w-16 h-1 rounded-full bg-gray-700" />
                </div>
                <div className="px-4 py-6 bg-gray-50 min-h-[480px]">
                    {/* Two filler cards so the sponsored card has context for spacing */}
                    <div className="rounded-2xl bg-white p-3 mb-3 shadow-sm">
                        <div className="h-2 w-20 bg-gray-200 rounded mb-2" />
                        <div className="h-4 w-full bg-gray-100 rounded mb-1" />
                        <div className="h-4 w-4/5 bg-gray-100 rounded" />
                    </div>

                    {/* The card */}
                    <div className="relative rounded-2xl bg-white p-4 shadow-sm border border-gray-100 overflow-hidden">
                        {/* Kind-aware left-edge stripe */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${variant.stripeClass}`} />
                        <div className="flex items-start justify-between mb-2">
                            <div className="flex flex-col gap-0.5">
                                {variant.pillLabel && (
                                    <span
                                        className={`self-start text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${variant.pillClass}`}
                                    >
                                        {variant.pillLabel}
                                    </span>
                                )}
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                    {sourceLabel(kind, fundingCompanyName, externalAdvertiserName)}
                                </span>
                            </div>
                            <button
                                aria-label="Dismiss"
                                className="text-gray-300"
                                type="button"
                            >
                                <X size={14} />
                            </button>
                        </div>

                        {imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={imageUrl}
                                alt=""
                                className="w-full h-32 object-cover rounded-xl mb-3 bg-gray-100"
                                onError={(e) => {
                                    // Gracefully hide on load failure — same behavior the
                                    // mobile SponsoredCard implements (M6).
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        ) : null}

                        <h3 className="text-base font-semibold text-gray-900 leading-tight mb-1">
                            {title || <span className="text-gray-300">Your title</span>}
                        </h3>
                        <p className="text-sm text-gray-600 leading-snug">
                            {body || <span className="text-gray-300">Your message will appear here.</span>}
                        </p>

                        {ctaLabel || ctaUrl ? (
                            <div className="mt-3 flex justify-end">
                                <span className="inline-flex items-center text-xs font-semibold text-gray-900 bg-gray-100 px-3 py-1.5 rounded-full">
                                    {ctaLabel || 'Learn more'}
                                </span>
                            </div>
                        ) : null}
                    </div>

                    <div className="rounded-2xl bg-white p-3 mt-3 shadow-sm">
                        <div className="h-2 w-24 bg-gray-200 rounded mb-2" />
                        <div className="h-4 w-full bg-gray-100 rounded mb-1" />
                        <div className="h-4 w-3/4 bg-gray-100 rounded" />
                    </div>
                </div>
            </div>
        </div>
    );
}
