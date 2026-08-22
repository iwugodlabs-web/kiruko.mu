"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

interface ExampleCalloutProps {
    /** Short button label. Defaults to "See example". */
    label?: string;
    /** Optional one-line subtitle shown next to the EXAMPLE badge when expanded. */
    caption?: string;
    /** Start expanded. Defaults to false. */
    defaultOpen?: boolean;
    /** The example content. Render the same shape as the real UI with dummy data. */
    children: ReactNode;
    className?: string;
}

/**
 * Collapsible "See example" panel for empty / first-use surfaces. The body
 * renders inside a dashed-border block with an EXAMPLE badge so the dummy
 * data is unmistakable. Stateful: each instance has its own open/closed.
 */
export default function ExampleCallout({
    label = "See example",
    caption,
    defaultOpen = false,
    children,
    className = "",
}: ExampleCalloutProps) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={className}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                aria-expanded={open}
            >
                <Sparkles className="h-3.5 w-3.5" />
                {label}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
                <div className="mt-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/40 dark:border-blue-500/40 dark:bg-blue-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex items-center rounded bg-blue-600 text-white text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5">
                            Example
                        </span>
                        {caption && <span className="text-xs text-zinc-600 dark:text-zinc-400">{caption}</span>}
                    </div>
                    <div className="text-sm text-zinc-700 dark:text-zinc-300">{children}</div>
                </div>
            )}
        </div>
    );
}
