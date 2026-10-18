"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Ruler, Boxes, Tag, Check, Upload, Pencil, Trash2, Archive, ArchiveRestore, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  deleteProduct,
  createVariant,
  updateVariant,
  deleteVariant,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listUoms,
  createUom,
  deleteUom,
  type Product,
  type ProductCategory,
  type ProductVariant,
  type UnitOfMeasure,
} from "@/services/fieldSales";
import EmptyState from "@/components/ui/EmptyState";
import SearchInput from "@/components/ui/SearchInput";
import Hint from "./Hint";
import CategoryCombobox from "./CategoryCombobox";
import ProductImportModal from "./ProductImportModal";
import type { NavigateTab } from "./types";

const PAGE_SIZE = 10;

/** Pull the backend's `detail` message out of an axios error, with a fallback. */
function apiErr(err: unknown, fallback = "Something went wrong."): string {
  const e = err as { response?: { data?: { detail?: string } } };
  return e?.response?.data?.detail ?? fallback;
}

function makeSku(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  return `${base || "SKU"}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export default function CatalogTab({ onNavigate }: { onNavigate: NavigateTab }) {
  const { companyId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [uoms, setUoms] = useState<UnitOfMeasure[]>([]);
  const [loading, setLoading] = useState(false);

  const [newProduct, setNewProduct] = useState({ name: "", category: "", price: "" });
  const [variantDraft, setVariantDraft] = useState<Record<number, { sku: string; unit_price: string; barcode: string }>>({});
  const [newCategory, setNewCategory] = useState("");
  const [newUom, setNewUom] = useState({ code: "", name: "", factor: "1" });

  // Per-product category edits, kept local until committed, plus which rows are saving.
  const [categoryEdits, setCategoryEdits] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  // List controls: search, category filter, and how many rows are shown.
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [importOpen, setImportOpen] = useState(false);

  // Inline edit/draft state for products, variants and categories.
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [productEdits, setProductEdits] = useState<Record<number, { name: string; brand: string }>>({});
  const [editingVariant, setEditingVariant] = useState<number | null>(null);
  const [variantEdits, setVariantEdits] = useState<Record<number, { sku: string; unit_price: string; barcode: string }>>({});
  const [editingCategory, setEditingCategory] = useState<number | null>(null);
  const [categoryNameEdits, setCategoryNameEdits] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const [p, c, u] = await Promise.all([
        listProducts(companyId, true),
        listCategories(companyId),
        listUoms(companyId),
      ]);
      setProducts(p);
      setCategories(c);
      setUoms(u);
    } catch {
      toast.error("Failed to load catalog.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Every category name the user could pick: managed categories + any already
  // used on a product (Phase 0 stored categories as free text). Keeps the two
  // in step so nothing "goes missing".
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((c) => c.name && set.add(c.name));
    products.forEach((p) => p.category && set.add(p.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categories, products]);

  // Managed-vs-derived split: a name typed onto a product (Phase 0 free text)
  // may have no ProductCategory row, so it can be filtered but not renamed.
  const categoryRows = useMemo(
    () =>
      categoryOptions.map((name) => ({
        name,
        managed: categories.find((c) => c.name === name) ?? null,
      })),
    [categoryOptions, categories],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filter !== "all" && (p.category ?? "") !== filter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q) ||
        p.variants.some((v) => v.sku.toLowerCase().includes(q))
      );
    });
  }, [products, search, filter]);

  // Reset paging whenever the result set changes.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [search, filter]);

  const shown = filtered.slice(0, visible);

  function countFor(name: string): number {
    return products.filter((p) => (p.category ?? "") === name).length;
  }

  /** Make sure a category the user typed exists in the managed list. */
  async function ensureCategory(name: string) {
    if (!companyId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return;
    try {
      const created = await createCategory(companyId, { name: trimmed });
      setCategories((cs) => [...cs, created].sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      /* 409 (already exists) or transient — the product tag still saves */
    }
  }

  async function handleCreateProduct() {
    if (!companyId || !newProduct.name.trim()) return;
    const name = newProduct.name.trim();
    const category = newProduct.category.trim();
    try {
      await createProduct(companyId, {
        name,
        category: category || null,
        default_variant: newProduct.price
          ? { sku: makeSku(name), unit_price: newProduct.price }
          : undefined,
      });
      await ensureCategory(category);
      setNewProduct({ name: "", category: "", price: "" });
      toast.success(newProduct.price ? "Product added with a price." : "Product created.");
      load();
    } catch {
      toast.error("Could not create product.");
    }
  }

  async function handleAddVariant(product: Product) {
    if (!companyId) return;
    const d = variantDraft[product.id];
    if (!d || !d.sku.trim() || !d.unit_price) {
      toast.error("SKU and price are required.");
      return;
    }
    try {
      await createVariant(companyId, product.id, {
        sku: d.sku.trim(),
        unit_price: d.unit_price,
        barcode: d.barcode || null,
        is_default: product.variants.length === 0,
      });
      setVariantDraft((s) => ({ ...s, [product.id]: { sku: "", unit_price: "", barcode: "" } }));
      toast.success("Variant added.");
      load();
    } catch {
      toast.error("Could not add variant.");
    }
  }

  async function commitCategory(product: Product) {
    if (!companyId) return;
    const next = (categoryEdits[product.id] ?? product.category ?? "").trim();
    if (next === (product.category ?? "")) return;
    setSavingId(product.id);
    try {
      const updated = await updateProduct(companyId, product.id, { category: next || null });
      setProducts((ps) => ps.map((p) => (p.id === product.id ? { ...p, category: updated.category } : p)));
      if (next) await ensureCategory(next);
      toast.success(next ? `Tagged “${product.name}” as ${next}.` : "Category cleared.");
    } catch {
      toast.error("Could not update category.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateCategory() {
    if (!companyId || !newCategory.trim()) return;
    try {
      const created = await createCategory(companyId, { name: newCategory.trim() });
      setCategories((cs) => [...cs, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCategory("");
      toast.success("Category created.");
    } catch {
      toast.error("Could not create category.");
    }
  }

  // ── Product edit / archive / delete ──────────────────────────────────────
  function startProductEdit(p: Product) {
    setProductEdits((s) => ({ ...s, [p.id]: { name: p.name, brand: p.brand ?? "" } }));
    setEditingProduct(p.id);
  }

  async function saveProduct(p: Product) {
    if (!companyId) return;
    const e = productEdits[p.id];
    if (!e) return;
    setBusyId(`p-${p.id}`);
    try {
      const updated = await updateProduct(companyId, p.id, {
        name: e.name.trim() || p.name,
        brand: e.brand.trim() || null,
      });
      setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, name: updated.name, brand: updated.brand } : x)));
      setEditingProduct(null);
      toast.success("Product updated.");
    } catch (err) {
      toast.error(apiErr(err, "Could not update product."));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchive(p: Product) {
    if (!companyId) return;
    const isArchived = p.status === "discontinued";
    setBusyId(`a-${p.id}`);
    try {
      await archiveProduct(companyId, p.id, !isArchived);
      toast.success(isArchived ? `“${p.name}” restored.` : `“${p.name}” archived.`);
      load();
    } catch (err) {
      toast.error(apiErr(err, "Could not update product."));
    } finally {
      setBusyId(null);
    }
  }

  async function removeProduct(p: Product) {
    if (!companyId) return;
    if (!confirm(`Delete “${p.name}” permanently? This cannot be undone.`)) return;
    setBusyId(`d-${p.id}`);
    try {
      await deleteProduct(companyId, p.id);
      toast.success("Product deleted.");
      load();
    } catch (err) {
      toast.error(apiErr(err, "Could not delete product."));
    } finally {
      setBusyId(null);
    }
  }

  // ── Variant edit / delete ────────────────────────────────────────────────
  function startVariantEdit(v: ProductVariant) {
    setVariantEdits((s) => ({ ...s, [v.id]: { sku: v.sku, unit_price: v.unit_price, barcode: v.barcode ?? "" } }));
    setEditingVariant(v.id);
  }

  async function saveVariant(p: Product, v: ProductVariant) {
    if (!companyId) return;
    const e = variantEdits[v.id];
    if (!e) return;
    if (!e.sku.trim() || !e.unit_price) {
      toast.error("SKU and price are required.");
      return;
    }
    setBusyId(`v-${v.id}`);
    try {
      await updateVariant(companyId, p.id, v.id, {
        sku: e.sku.trim(),
        unit_price: e.unit_price,
        barcode: e.barcode || null,
      });
      setEditingVariant(null);
      toast.success("Variant updated.");
      load();
    } catch (err) {
      toast.error(apiErr(err, "Could not update variant."));
    } finally {
      setBusyId(null);
    }
  }

  async function removeVariant(p: Product, v: ProductVariant) {
    if (!companyId) return;
    if (!confirm(`Delete SKU ${v.sku}? This cannot be undone.`)) return;
    setBusyId(`vd-${v.id}`);
    try {
      await deleteVariant(companyId, p.id, v.id);
      toast.success("Variant deleted.");
      load();
    } catch (err) {
      toast.error(apiErr(err, "Could not delete variant."));
    } finally {
      setBusyId(null);
    }
  }

  // ── Category rename / delete ─────────────────────────────────────────────
  async function saveCategoryName(c: ProductCategory) {
    if (!companyId) return;
    const next = (categoryNameEdits[c.id] ?? c.name).trim();
    if (!next || next === c.name) {
      setEditingCategory(null);
      return;
    }
    setBusyId(`c-${c.id}`);
    try {
      await updateCategory(companyId, c.id, { name: next });
      setEditingCategory(null);
      toast.success("Category renamed.");
      load();
    } catch (err) {
      toast.error(apiErr(err, "Could not rename category."));
    } finally {
      setBusyId(null);
    }
  }

  async function removeCategory(c: ProductCategory) {
    if (!companyId) return;
    if (!confirm(
      `Delete category “${c.name}”? Products tagged with it will be left uncategorised.`,
    )) return;
    setBusyId(`cd-${c.id}`);
    try {
      const res = await deleteCategory(companyId, c.id);
      toast.success(
        res.products_retagged
          ? `Category deleted — ${res.products_retagged} product(s) untagged.`
          : "Category deleted.",
      );
      load();
    } catch (err) {
      toast.error(apiErr(err, "Could not delete category."));
    } finally {
      setBusyId(null);
    }
  }

  async function removeUom(u: UnitOfMeasure) {
    if (!companyId) return;
    if (!confirm(`Delete unit ${u.code}?`)) return;
    setBusyId(`u-${u.id}`);
    try {
      await deleteUom(companyId, u.id);
      toast.success("Unit deleted.");
      load();
    } catch (err) {
      toast.error(apiErr(err, "Could not delete unit."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateUom() {
    if (!companyId || !newUom.code.trim() || !newUom.name.trim()) return;
    try {
      await createUom(companyId, { code: newUom.code.trim(), name: newUom.name.trim(), factor: newUom.factor || "1" });
      setNewUom({ code: "", name: "", factor: "1" });
      toast.success("Unit of measure created.");
      load();
    } catch {
      toast.error("Could not create unit of measure.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Boxes className="h-4 w-4" /> Products
            </h2>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <Upload className="h-3.5 w-3.5" /> Import CSV
            </button>
          </div>

          <Hint
            title="This is what reps sell"
            className="mb-4"
            action={
              <button
                type="button"
                onClick={() => onNavigate("plans")}
                className="whitespace-nowrap rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300"
              >
                Next: Plans →
              </button>
            }
          >
            Add each product and its price. Tag products with a category to group them (and to target
            rules at a category later). Reps pick from this list in the mobile app.
          </Hint>

          {/* Search + category filter so a big catalog stays manageable. */}
          {products.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SearchInput value={search} onChange={setSearch} placeholder="Search products or SKU…" className="flex-1 min-w-[180px]" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              >
                <option value="all">All categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{c} ({countFor(c)})</option>
                ))}
                <option value="">Uncategorised</option>
              </select>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            <input
              placeholder="Product name"
              value={newProduct.name}
              onChange={(e) => setNewProduct((s) => ({ ...s, name: e.target.value }))}
              className="flex-1 min-w-[160px] rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
            />
            <input
              placeholder="Price"
              inputMode="decimal"
              value={newProduct.price}
              onChange={(e) => setNewProduct((s) => ({ ...s, price: e.target.value }))}
              className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
            />
            <CategoryCombobox
              listId="new-product-categories"
              value={newProduct.category}
              options={categoryOptions}
              onChange={(v) => setNewProduct((s) => ({ ...s, category: v }))}
              placeholder="Category (type or pick)"
              className="min-w-[170px]"
            />
            <button
              onClick={handleCreateProduct}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-3 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          ) : products.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No products yet"
              description="Add your first product above — give it a name and a price and it's ready for reps to sell."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              mode="no-results"
              icon={Boxes}
              title="No products match"
              description="Try a different search term or category."
              actionLabel="Clear filters"
              onAction={() => {
                setSearch("");
                setFilter("all");
              }}
            />
          ) : (
            <>
              <div className="space-y-4">
                {shown.map((p) => {
                  const d = variantDraft[p.id] ?? { sku: "", unit_price: "", barcode: "" };
                  return (
                    <div key={p.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          {editingProduct === p.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                autoFocus
                                value={productEdits[p.id]?.name ?? ""}
                                onChange={(e) => setProductEdits((s) => ({ ...s, [p.id]: { ...s[p.id], name: e.target.value } }))}
                                placeholder="Product name"
                                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
                              />
                              <input
                                value={productEdits[p.id]?.brand ?? ""}
                                onChange={(e) => setProductEdits((s) => ({ ...s, [p.id]: { ...s[p.id], brand: e.target.value } }))}
                                placeholder="Brand (optional)"
                                className="w-32 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
                              />
                              <button onClick={() => saveProduct(p)} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-[11px] font-medium text-emerald-700">
                                <Check className="h-3 w-3" /> Save
                              </button>
                              <button onClick={() => setEditingProduct(null)} className="text-[11px] text-gray-500">Cancel</button>
                            </div>
                          ) : (
                            <span className="font-medium text-gray-900 dark:text-white">
                              {p.name}
                              {p.brand && <span className="ml-2 text-xs font-normal text-gray-400">{p.brand}</span>}
                              {p.status === "discontinued" && (
                                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">archived</span>
                              )}
                            </span>
                          )}
                          <div className="mt-1 flex items-center gap-1.5">
                            <Tag className="h-3 w-3 text-gray-400" />
                            <CategoryCombobox
                              listId={`product-cat-${p.id}`}
                              value={categoryEdits[p.id] ?? p.category ?? ""}
                              options={categoryOptions}
                              onChange={(v) => setCategoryEdits((s) => ({ ...s, [p.id]: v }))}
                              onCommit={() => commitCategory(p)}
                              placeholder="Uncategorised"
                              compact
                              className="w-40"
                            />
                            {savingId === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                            ) : (categoryEdits[p.id] ?? p.category ?? "") !== (p.category ?? "") ? (
                              <button
                                onClick={() => commitCategory(p)}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                              >
                                <Check className="h-3 w-3" /> Save
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          {busyId === `a-${p.id}` || busyId === `d-${p.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                          ) : (
                            <>
                              <button title="Edit name / brand" onClick={() => startProductEdit(p)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                title={p.status === "discontinued" ? "Restore" : "Archive"}
                                onClick={() => toggleArchive(p)}
                                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                              >
                                {p.status === "discontinued" ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                              </button>
                              <button title="Delete" onClick={() => removeProduct(p)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {p.variants.map((v) =>
                          editingVariant === v.id ? (
                            <span key={v.id} className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs">
                              <input
                                autoFocus
                                value={variantEdits[v.id]?.sku ?? ""}
                                onChange={(e) => setVariantEdits((s) => ({ ...s, [v.id]: { ...s[v.id], sku: e.target.value } }))}
                                placeholder="SKU"
                                className="w-20 rounded border border-gray-200 dark:border-gray-700 bg-transparent px-1 py-0.5"
                              />
                              <input
                                value={variantEdits[v.id]?.unit_price ?? ""}
                                onChange={(e) => setVariantEdits((s) => ({ ...s, [v.id]: { ...s[v.id], unit_price: e.target.value } }))}
                                inputMode="decimal"
                                placeholder="Price"
                                className="w-16 rounded border border-gray-200 dark:border-gray-700 bg-transparent px-1 py-0.5"
                              />
                              <input
                                value={variantEdits[v.id]?.barcode ?? ""}
                                onChange={(e) => setVariantEdits((s) => ({ ...s, [v.id]: { ...s[v.id], barcode: e.target.value } }))}
                                placeholder="Barcode"
                                className="w-24 rounded border border-gray-200 dark:border-gray-700 bg-transparent px-1 py-0.5"
                              />
                              <button onClick={() => saveVariant(p, v)} title="Save" className="text-emerald-600"><Check className="h-3.5 w-3.5" /></button>
                              <button onClick={() => setEditingVariant(null)} title="Cancel" className="text-gray-500"><X className="h-3.5 w-3.5" /></button>
                            </span>
                          ) : (
                            <span key={v.id} className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs">
                              {v.sku} · {v.currency} {v.unit_price}
                              {v.is_default && <span className="text-emerald-600">default</span>}
                              <button onClick={() => startVariantEdit(v)} title="Edit variant" className="text-gray-400 hover:text-gray-700">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button onClick={() => removeVariant(p, v)} title="Delete variant" className="text-gray-400 hover:text-red-600">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </span>
                          ),
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          placeholder="SKU"
                          value={d.sku}
                          onChange={(e) => setVariantDraft((s) => ({ ...s, [p.id]: { ...d, sku: e.target.value } }))}
                          className="w-28 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-xs"
                        />
                        <input
                          placeholder="Price"
                          inputMode="decimal"
                          value={d.unit_price}
                          onChange={(e) => setVariantDraft((s) => ({ ...s, [p.id]: { ...d, unit_price: e.target.value } }))}
                          className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-xs"
                        />
                        <input
                          placeholder="Barcode"
                          value={d.barcode}
                          onChange={(e) => setVariantDraft((s) => ({ ...s, [p.id]: { ...d, barcode: e.target.value } }))}
                          className="w-32 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-xs"
                        />
                        <button
                          onClick={() => handleAddVariant(p)}
                          className="rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          Add variant
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <span>
                  Showing {shown.length} of {filtered.length}
                  {filtered.length !== products.length ? ` (filtered from ${products.length})` : ""}
                </span>
                {visible < filtered.length && (
                  <button
                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    Load {Math.min(PAGE_SIZE, filtered.length - visible)} more
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h3 className="font-medium text-gray-900 dark:text-white mb-1 flex items-center gap-2">
            <Tag className="h-4 w-4" /> Categories
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            Group your products. Click one to filter the list — you can also add a category on a
            product directly and it appears here.
          </p>
          <div className="flex gap-2 mb-3">
            <input
              placeholder="New category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-1.5 text-sm"
            />
            <button onClick={handleCreateCategory} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {categoryRows.map(({ name, managed }) => (
              <li key={name}>
                {managed && editingCategory === managed.id ? (
                  <div className="flex items-center gap-1 px-1 py-0.5">
                    <input
                      autoFocus
                      value={categoryNameEdits[managed.id] ?? name}
                      onChange={(e) => setCategoryNameEdits((s) => ({ ...s, [managed.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && saveCategoryName(managed)}
                      className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
                    />
                    <button onClick={() => saveCategoryName(managed)} title="Save" className="text-emerald-600"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setEditingCategory(null)} title="Cancel" className="text-gray-500"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <div className={`flex items-center gap-1 rounded-md px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    filter === name ? "bg-gray-100 dark:bg-gray-800" : ""
                  }`}>
                    <button onClick={() => setFilter(filter === name ? "all" : name)} className="flex-1 truncate text-left">
                      {name}
                    </button>
                    <span className="text-xs text-gray-400">{countFor(name)}</span>
                    {managed ? (
                      <span className="flex items-center gap-0.5">
                        <button
                          title="Rename category"
                          onClick={() => {
                            setCategoryNameEdits((s) => ({ ...s, [managed.id]: name }));
                            setEditingCategory(managed.id);
                          }}
                          className="text-gray-400 hover:text-gray-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button title="Delete category" onClick={() => removeCategory(managed)} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300" title="Only on a product — add it as a category to rename">free-text</span>
                    )}
                  </div>
                )}
              </li>
            ))}
            {categoryOptions.length === 0 && (
              <li className="py-2 text-xs text-gray-400">No categories yet — add one above.</li>
            )}
          </ul>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h3 className="font-medium text-gray-900 dark:text-white mb-1 flex items-center gap-2">
            <Ruler className="h-4 w-4" /> Units of measure
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            Optional. Use these for per-unit commissions — e.g. a case sold as 24 bottles.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              placeholder="Code"
              value={newUom.code}
              onChange={(e) => setNewUom((s) => ({ ...s, code: e.target.value }))}
              className="w-16 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Name"
              value={newUom.name}
              onChange={(e) => setNewUom((s) => ({ ...s, name: e.target.value }))}
              className="flex-1 min-w-[90px] rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Factor"
              inputMode="decimal"
              value={newUom.factor}
              onChange={(e) => setNewUom((s) => ({ ...s, factor: e.target.value }))}
              className="w-20 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
            />
            <button onClick={handleCreateUom} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {uoms.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                <span><span className="font-mono text-xs">{u.code}</span> {u.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">×{u.factor}</span>
                  <button title="Delete unit" onClick={() => removeUom(u)} className="text-gray-400 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
            {uoms.length === 0 && <li className="py-2 text-xs text-gray-400">No units yet.</li>}
          </ul>
        </div>
      </div>

      {companyId && (
        <ProductImportModal
          companyId={companyId}
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={load}
        />
      )}
    </div>
  );
}
