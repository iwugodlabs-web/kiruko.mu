"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Ruler, Boxes } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listProducts,
  createProduct,
  createVariant,
  listCategories,
  createCategory,
  listUoms,
  createUom,
  type Product,
  type ProductCategory,
  type UnitOfMeasure,
} from "@/services/fieldSales";

export default function CatalogTab() {
  const { companyId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [uoms, setUoms] = useState<UnitOfMeasure[]>([]);
  const [loading, setLoading] = useState(false);

  const [newProduct, setNewProduct] = useState({ name: "", category: "" });
  const [variantDraft, setVariantDraft] = useState<Record<number, { sku: string; unit_price: string; barcode: string }>>({});
  const [newCategory, setNewCategory] = useState("");
  const [newUom, setNewUom] = useState({ code: "", name: "", factor: "1" });

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

  async function handleCreateProduct() {
    if (!companyId || !newProduct.name.trim()) return;
    try {
      await createProduct(companyId, {
        name: newProduct.name.trim(),
        category: newProduct.category || null,
      });
      setNewProduct({ name: "", category: "" });
      toast.success("Product created.");
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

  async function handleCreateCategory() {
    if (!companyId || !newCategory.trim()) return;
    try {
      await createCategory(companyId, { name: newCategory.trim() });
      setNewCategory("");
      toast.success("Category created.");
      load();
    } catch {
      toast.error("Could not create category.");
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
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Boxes className="h-4 w-4" /> Products
          </h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              placeholder="Product name"
              value={newProduct.name}
              onChange={(e) => setNewProduct((s) => ({ ...s, name: e.target.value }))}
              className="flex-1 min-w-[160px] rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
            />
            <select
              value={newProduct.category}
              onChange={(e) => setNewProduct((s) => ({ ...s, category: e.target.value }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
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
            <div className="py-8 text-center text-sm text-gray-500">No products yet.</div>
          ) : (
            <div className="space-y-4">
              {products.map((p) => {
                const d = variantDraft[p.id] ?? { sku: "", unit_price: "", barcode: "" };
                return (
                  <div key={p.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">{p.name}</span>
                        {p.category && (
                          <span className="ml-2 text-xs text-gray-500">{p.category}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{p.variants.length} variant(s)</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {p.variants.map((v) => (
                        <span key={v.id} className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs">
                          {v.sku} · {v.currency} {v.unit_price}
                          {v.is_default && <span className="text-emerald-600">default</span>}
                        </span>
                      ))}
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
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h3 className="font-medium text-gray-900 dark:text-white mb-3">Categories</h3>
          <div className="flex gap-2 mb-3">
            <input
              placeholder="New category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-1.5 text-sm"
            />
            <button onClick={handleCreateCategory} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                <span>{c.name}</span>
                <Trash2 className="h-3.5 w-3.5 text-gray-300" />
              </li>
            ))}
            {categories.length === 0 && <li className="text-gray-400 text-xs py-2">No categories yet.</li>}
          </ul>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h3 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Ruler className="h-4 w-4" /> Units of measure
          </h3>
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
                <span className="text-xs text-gray-400">×{u.factor}</span>
              </li>
            ))}
            {uoms.length === 0 && <li className="text-gray-400 text-xs py-2">No units yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
