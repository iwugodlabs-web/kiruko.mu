"use client";

/**
 * A plain category field that both picks from existing categories and accepts
 * a brand-new one typed by the user (native <input list> + <datalist>). This
 * replaces the old `<select>` that only offered whatever categories had been
 * pre-created elsewhere — the reason "I added a category but can't tag a
 * product with it" happened: the two were disconnected.
 */
export default function CategoryCombobox({
  value,
  options,
  onChange,
  onCommit,
  listId,
  placeholder = "Category",
  compact = false,
  className = "",
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Called on blur / Enter so an inline edit can be persisted. */
  onCommit?: () => void;
  /** Unique id for the <datalist>; must be stable and unique per instance. */
  listId: string;
  placeholder?: string;
  /** Smaller variant used inline on a product row. */
  compact?: boolean;
  className?: string;
}) {
  const size = compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";
  return (
    <>
      <input
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit?.();
          }
        }}
        className={`rounded-lg border border-gray-200 bg-transparent dark:border-gray-700 ${size} ${className}`}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}
