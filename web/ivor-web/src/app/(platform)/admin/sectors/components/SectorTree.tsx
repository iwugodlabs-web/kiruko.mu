"use client";
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Edit2, Trash2, Plus, Loader2 } from "lucide-react";
import {
  sectorAdmin,
  Sector,
  SectorCategory,
  SectorGrade,
} from "@/services/sectorAdmin";
import { toast } from "sonner";
import {
  CategoryFormModal,
  GradeFormModal,
  ConfirmDialog,
} from "./EntityFormModals";
import SalaryHistoryTable from "./SalaryHistoryTable";

export default function SectorTree(props: {
  sector: Sector;
  onSectorEdit: () => void;
  onSectorDelete: () => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const sectorId = props.sector.sector_id ?? props.sector.id!;
  const [expanded, setExpanded] = useState(false);
  const [categories, setCategories] = useState<SectorCategory[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<SectorCategory | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<SectorCategory | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const cats = await sectorAdmin.listCategoriesForSector(sectorId);
      setCategories(cats);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, props.reloadKey]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between p-3">
        <button
          onClick={() => setExpanded((s) => !s)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="font-semibold text-gray-900 dark:text-white">
            {props.sector.activity ?? props.sector.name}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {props.sector.country_code} · {props.sector.currency}
          </span>
        </button>
        <div className="flex gap-1">
          <button
            onClick={props.onSectorEdit}
            className="rounded p-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Edit sector"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={props.onSectorDelete}
            className="rounded p-1 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            title="Delete sector"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Categories ({categories.length})
            </span>
            <button
              onClick={() => setCreateCategoryOpen(true)}
              className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Plus size={12} /> Add category
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 py-3 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="animate-spin" size={14} /> Loading…
            </div>
          )}

          {!loading &&
            categories.map((cat) => (
              <CategoryNode
                key={cat.id}
                sectorId={sectorId}
                category={cat}
                isOpen={expandedCategoryId === cat.id}
                onToggle={() =>
                  setExpandedCategoryId(expandedCategoryId === cat.id ? null : cat.id)
                }
                onEdit={() => setEditCategory(cat)}
                onDelete={() => setDeleteCategory(cat)}
                onChanged={load}
              />
            ))}
        </div>
      )}

      {createCategoryOpen && (
        <CategoryFormModal
          mode="create"
          parentCurrency={props.sector.currency}
          onClose={() => setCreateCategoryOpen(false)}
          onSubmit={async (v) => {
            try {
              await sectorAdmin.createCategory({
                sector_id: sectorId,
                name: v.name,
                currency: props.sector.currency,
              });
              toast.success("Category created");
              setCreateCategoryOpen(false);
              load();
              props.onChanged();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to create category");
            }
          }}
        />
      )}

      {editCategory && (
        <CategoryFormModal
          mode="edit"
          initial={{ name: editCategory.name, currency: editCategory.currency }}
          parentCurrency={props.sector.currency}
          onClose={() => setEditCategory(null)}
          onSubmit={async (v) => {
            try {
              await sectorAdmin.updateCategory(editCategory.id, { name: v.name });
              toast.success("Category updated");
              setEditCategory(null);
              load();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to update category");
            }
          }}
        />
      )}

      {deleteCategory && (
        <ConfirmDialog
          title="Delete category?"
          destructive
          confirmLabel="Delete"
          message={
            <p>
              Deletes <strong>{deleteCategory.name}</strong>. Refuses if grades or salary rows still exist
              (salary rows are append-only — void them before delete, or void all-but-keep history).
            </p>
          }
          onClose={() => setDeleteCategory(null)}
          onConfirm={async () => {
            try {
              await sectorAdmin.deleteCategory(deleteCategory.id);
              toast.success("Category deleted");
              setDeleteCategory(null);
              load();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to delete category");
            }
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CategoryNode — expands to show grades + salary history
// ─────────────────────────────────────────────────────────────────────────
function CategoryNode(props: {
  sectorId: number;
  category: SectorCategory;
  isOpen: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [grades, setGrades] = useState<SectorGrade[]>([]);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [createGradeOpen, setCreateGradeOpen] = useState(false);
  const [editGrade, setEditGrade] = useState<SectorGrade | null>(null);
  const [deleteGrade, setDeleteGrade] = useState<SectorGrade | null>(null);

  const loadGrades = async () => {
    setGradesLoading(true);
    try {
      const g = await sectorAdmin.listGradesForCategory(props.category.id);
      setGrades(g);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to load grades");
    } finally {
      setGradesLoading(false);
    }
  };

  useEffect(() => {
    if (props.isOpen) loadGrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isOpen]);

  return (
    <div className="mb-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between p-2">
        <button onClick={props.onToggle} className="flex flex-1 items-center gap-2 text-left">
          {props.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-sm font-medium text-gray-900 dark:text-white">{props.category.name}</span>
        </button>
        <div className="flex gap-1">
          <button onClick={props.onEdit} className="rounded p-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Edit2 size={12} />
          </button>
          <button onClick={props.onDelete} className="rounded p-1 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {props.isOpen && (
        <div className="space-y-3 border-t border-gray-100 dark:border-gray-800 p-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Grades ({grades.length})
              </span>
              <button
                onClick={() => setCreateGradeOpen(true)}
                className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Plus size={12} /> Add grade
              </button>
            </div>
            {gradesLoading && <p className="text-xs text-gray-500 dark:text-gray-400">Loading…</p>}
            {!gradesLoading && grades.length === 0 && (
              <p className="text-xs italic text-gray-500 dark:text-gray-400">No grades. Salary versions can still be appended without a grade.</p>
            )}
            <ul className="space-y-1">
              {grades.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded bg-gray-50 dark:bg-gray-800/60 px-2 py-1 text-xs"
                >
                  <span>{g.grade ?? `(unnamed grade #${g.id})`}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditGrade(g)}
                      className="rounded p-1 text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800"
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      onClick={() => setDeleteGrade(g)}
                      className="rounded p-1 text-red-500 dark:text-red-400 hover:bg-white dark:hover:bg-gray-800"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <SalaryHistoryTable
            categoryId={props.category.id}
            currency={props.category.currency}
            grades={grades}
          />
        </div>
      )}

      {createGradeOpen && (
        <GradeFormModal
          mode="create"
          onClose={() => setCreateGradeOpen(false)}
          onSubmit={async (v) => {
            try {
              await sectorAdmin.createGrade({
                sector_id: props.sectorId,
                sector_category_id: props.category.id,
                grade: v.grade,
              });
              toast.success("Grade created");
              setCreateGradeOpen(false);
              loadGrades();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to create grade");
            }
          }}
        />
      )}

      {editGrade && (
        <GradeFormModal
          mode="edit"
          initial={{ grade: editGrade.grade }}
          onClose={() => setEditGrade(null)}
          onSubmit={async (v) => {
            try {
              await sectorAdmin.updateGrade(editGrade.id, { grade: v.grade });
              toast.success("Grade updated");
              setEditGrade(null);
              loadGrades();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to update grade");
            }
          }}
        />
      )}

      {deleteGrade && (
        <ConfirmDialog
          title="Delete grade?"
          destructive
          confirmLabel="Delete"
          message={
            <p>
              Refuses if salary rows reference this grade (salary rows are append-only — void them first
              or use the grade-less category-level rows).
            </p>
          }
          onClose={() => setDeleteGrade(null)}
          onConfirm={async () => {
            try {
              await sectorAdmin.deleteGrade(deleteGrade.id);
              toast.success("Grade deleted");
              setDeleteGrade(null);
              loadGrades();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to delete grade");
            }
          }}
        />
      )}
    </div>
  );
}
