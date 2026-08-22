"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from 'react-dom';
import { Target, Edit3, Plus, Clock, Activity, CheckCircle, Search, Filter, ArrowRightLeft, RefreshCw, MoreVertical, MapPin, Users, Calendar, ChevronDown, AlertTriangle, MessageSquare } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import AssigneePicker from './AssigneePicker';
import LocationPicker from './LocationPicker';
import SectionHeader from "@/components/ui/SectionHeader";
import MetricCard from "@/components/ui/MetricCard";
import { useAuth } from "@/contexts/AuthContext";
import DashboardHeader from "@/components/ui/DashboardHeader";
import { api, getCurrentUser } from "@/services/apiClient";
import SolarisBackground from "@/components/ui/SolarisBackground";
import { searchCompanyUsers, fetchCompanyUsers as fetchApprovedCompanyUsers, verifyScheduleCompletion, type VerifyCompletionResult } from '@/services/api';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import EmptyState from "@/components/ui/EmptyState";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { toast } from "sonner";

export default function TasksSection() {
  const router = useRouter();
  const { user, companyId: authCompanyId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);


  // Filters & pagination — restored from URL on mount, mirrored back on change.
  const searchParamsHook = useSearchParams();
  const pathname = usePathname();
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'pending' | 'started' | 'completed' | 'cancelled'>(
    () => (searchParamsHook?.get('status') as 'all' | 'draft' | 'pending' | 'started' | 'completed' | 'cancelled') ?? 'all'
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() => searchParamsHook?.get('assignee') ?? 'all');
  const [searchTerm, setSearchTerm] = useState<string>(() => searchParamsHook?.get('q') ?? '');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>(
    () => (searchParamsHook?.get('view') as 'list' | 'kanban') ?? 'list'
  );
  const [page, setPage] = useState(() => Math.max(1, Number(searchParamsHook?.get('page') ?? 1)));
  const [pageSize, setPageSize] = useState(10);

  // Mirror filter state into the URL so back-button, refresh, and shared links restore the view.
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (assigneeFilter !== 'all') params.set('assignee', assigneeFilter);
    if (searchTerm) params.set('q', searchTerm);
    if (viewMode !== 'list') params.set('view', viewMode);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname || '/dashboard/tasks', { scroll: false });
  }, [statusFilter, assigneeFilter, searchTerm, viewMode, page, pathname, router]);

  // Edit/Create modals
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);
  const [originalEditData, setOriginalEditData] = useState<Record<string, unknown> | null>(null);

  const [companyUsers, setCompanyUsers] = useState<Array<Record<string, unknown>> | null>(null);
  const [companyUsersLoading, setCompanyUsersLoading] = useState(false);
  const [companyUsersError, setCompanyUsersError] = useState<string | null>(null);
  const [companyIdState, setCompanyIdState] = useState<number | null>(null);
  const [assigneeCandidates, setAssigneeCandidates] = useState<Array<Record<string, unknown>> | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const [searchingAssignees, setSearchingAssignees] = useState(false);

  const isVerifiedUser = (u?: Record<string, unknown>) => {
    if (!u) return false;
    // Check various verification fields
    if ((u as any).user_verified === true) return true;
    if ((u as any).private_user && (((u as any).private_user as any).user_verified === true || ((u as any).private_user as any).verified === true)) return true;
    if (String((u as any).user_verified) === 'true') return true;
    // Also accept if user has private_user with first_name (likely valid employee)
    if ((u as any).private_user?.first_name || (u as any).first_name) return true;
    return false;
  };

  // Human-readable location suggestions mapped to coordinates
  const LOCATION_SUGGESTIONS = [
    // Mauritius
    { name: 'Port Louis, Mauritius', lat: -20.1609, lng: 57.5012 },
    { name: 'Ebene, Mauritius', lat: -20.2200, lng: 57.5150 },
    { name: 'Quatre Bornes, Mauritius', lat: -20.2644, lng: 57.4797 },
    { name: 'Curepipe, Mauritius', lat: -20.3162, lng: 57.5166 },
    { name: 'Rose Hill, Mauritius', lat: -20.2333, lng: 57.4676 },
    { name: 'Vacoas-Phoenix, Mauritius', lat: -20.2983, lng: 57.4783 },
    { name: 'Mahebourg, Mauritius', lat: -20.4081, lng: 57.7000 },
    { name: 'Grand Baie, Mauritius', lat: -20.0167, lng: 57.5833 },
    { name: 'Flic en Flac, Mauritius', lat: -20.2750, lng: 57.3667 },
    { name: 'Moka, Mauritius', lat: -20.2167, lng: 57.5000 },
    // Africa
    { name: 'Durban, South Africa', lat: -29.8587, lng: 31.0218 },
    { name: 'Cape Town, South Africa', lat: -33.9249, lng: 18.4241 },
    { name: 'Johannesburg, South Africa', lat: -26.2041, lng: 28.0473 },
    { name: 'Mombasa, Kenya', lat: -4.0435, lng: 39.6682 },
    { name: 'Nairobi, Kenya', lat: -1.2921, lng: 36.8219 },
    // Europe/Other
    { name: 'London, UK', lat: 51.5074, lng: -0.1278 },
    { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
    { name: 'Dubai, UAE', lat: 25.2048, lng: 55.2708 },
  ];

  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  // cache last successful geolocation to avoid repeated permission prompts / waits
  const cachedGeoRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);

  const filteredLocationSuggestions = useMemo(() => {
    const q = String(editData?.location ?? '').toLowerCase().trim();
    if (!q) return LOCATION_SUGGESTIONS.slice(0, 8); // Show first 8 by default
    return LOCATION_SUGGESTIONS.filter(s => s.name.toLowerCase().includes(q));
  }, [editData?.location]);



  const fetchCompanyUsers = async (forceCompanyId?: number) => {
    const cid = forceCompanyId ?? companyIdState;

    if (!cid) {
      return;
    }
    setCompanyUsersLoading(true);
    setCompanyUsersError(null);

    try {
      const result = await fetchApprovedCompanyUsers(cid, 'approved');

      if ('error' in result) {
        setCompanyUsers([]);
        setCompanyUsersError((result as any).error || 'Failed to load employee list');
        return;
      }

      const users = result as any[];
      if (Array.isArray(users)) {
        setCompanyUsers(users);
      } else {
        setCompanyUsers([]);
      }
    } catch (err: unknown) {
      console.error('[TasksSection] Error fetching users:', err);
      setCompanyUsers(null);
      const e = err as unknown as Record<string, unknown> | undefined;
      const resp = e?.response as Record<string, unknown> | undefined;
      const status = resp && typeof resp.status === 'number' ? (resp.status as number) : undefined;
      if (status === 401 || status === 403) setCompanyUsersError('Not authenticated or not permitted to view employees');
      else setCompanyUsersError('Failed to load employee list');
    } finally {
      setCompanyUsersLoading(false);
    }
  };

  // Typeahead keyboard navigation state
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);

  // Helpers to add/remove assignees
  const addAssigneeByUid = (uid: number) => {
    const uidStr = String(uid);
    const existing = (((editData?.assigned_employee_ids as unknown) as number[]) || []).map(String).includes(uidStr);
    if (existing) {
      // toggle off
      removeAssigneeByUid(uid);
      return;
    }
    setEditData(d => ({ ...(d || {}), assigned_employee_ids: Array.from(new Set([...(d?.assigned_employee_ids as unknown as number[] || []), uid])), assigneeSearch: '' }));
    setAssigneeCandidates(null);
    setHighlightIndex(-1);
  };
  const removeAssigneeByUid = (uid: number) => {
    setEditData(d => ({ ...(d || {}), assigned_employee_ids: ((d?.assigned_employee_ids as unknown as number[]) || []).filter(n => String(n) !== String(uid)) }));
  };

  const useMyLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      toast.error('Geolocation not supported in this browser');
      return;
    }

    const now = Date.now();
    // use cached position if within 5 minutes
    const cache = cachedGeoRef.current;
    if (cache && (now - cache.ts) < (5 * 60 * 1000)) {
      setEditData(d => ({ ...(d || {}), location: `${cache.lat.toFixed(6)}, ${cache.lng.toFixed(6)}`, location_lat: cache.lat, location_lng: cache.lng }));
      toast.success('Using recent location');
      // refresh cache in background (don't block UX)
      navigator.geolocation.getCurrentPosition((pos) => {
        cachedGeoRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
      }, () => { }, { enableHighAccuracy: false, timeout: 8000 });
      return;
    }

    // otherwise request fresh position (faster: disable high accuracy to reduce wait)
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      cachedGeoRef.current = { lat: latitude, lng: longitude, ts: Date.now() };
      const locText = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      setEditData(d => ({ ...(d || {}), location: locText, location_lat: latitude, location_lng: longitude }));
      toast.success('Location captured');
    }, (err) => {
      console.warn('Geolocation error', err);
      toast.error('Failed to get location');
    }, { enableHighAccuracy: false, timeout: 8000 });
  };

  const handleLocationInputChange = (val: string) => {
    // If user typed/selected a named suggestion, map to lat/lng
    const match = LOCATION_SUGGESTIONS.find(s => String(s.name).toLowerCase() === String(val).toLowerCase());
    if (match) {
      setEditData(d => ({ ...(d || {}), location: match.name, location_lat: match.lat, location_lng: match.lng }));
    } else {
      // remove coordinates if free-text location entered
      setEditData(d => ({ ...(d || {}), location: val, location_lat: undefined, location_lng: undefined }));
    }
  };

  // Reset highlight when candidates or search text change
  useEffect(() => { setHighlightIndex(-1); }, [assigneeCandidates, editData?.assigneeSearch]);

  // Refs for modal focus management
  const createTitleRef = useRef<HTMLInputElement | null>(null);
  const assigneeInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (createModalOpen) {
      // Focus title input once when modal opens (don't re-focus on subsequent renders)
      setTimeout(() => createTitleRef.current?.focus(), 50);
      // Auto-load employees if not already loaded
      if (companyUsers === null && companyIdState !== null && !companyUsersLoading) {
        fetchCompanyUsers(companyIdState);
      }
    }
  }, [createModalOpen, companyIdState, companyUsers, companyUsersLoading]);

  // factor out loader so we can re-use when an update occurs
  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use companyId from AuthContext which resolves for both company owners
      // (user.company) and delegated HR/manager role-holders (private_user).
      let companyId = authCompanyId;
      if (!companyId) {
        const serverUser = await getCurrentUser();
        if (!('error' in serverUser)) {
          companyId =
            (serverUser as any)?.private_user?.company_id ??
            (serverUser as any)?.private_user?.company?.company_id ??
            (serverUser as any)?.company?.company_id ??
            null;
        }
      }
      if (!companyId) {
        setError('No company available for this account');
        setSchedules([]);
        setCompanyUsers(null);
        setCompanyIdState(null);
        setLoading(false);
        return;
      }
      // Stash company id so the New Task / Edit Task modals can render
      // the AssigneePicker. Without this, the gate `companyIdState !== null`
      // was false even after companyUsers loaded — so the modal showed
      // "No company available" and skipped the picker entirely.
      setCompanyIdState(companyId);
      const resp = await api.get(`/job/schedules/company/${companyId}`);
      setSchedules(Array.isArray(resp.data) ? resp.data : []);

      // also fetch company users for assignment UI (best-effort; we'll use server-side search when typing)
      try {
        const usersResp = await api.get(`/user/users/company/${companyId}`);
        const users = Array.isArray(usersResp.data) ? usersResp.data : [];
        setCompanyUsers(users.filter(isVerifiedUser));
      } catch {
        // ignore company users if unavailable (permissions) - fallback UI will be used
        setCompanyUsers(null);
      }
    } catch (err: unknown) {
      console.error('Failed to load schedules for tasks page', err);
      const message = (err && typeof err === 'object' && 'message' in err) ? String((err as { message?: unknown }).message) : undefined;
      // If axios error, we still log details
      setError(message || 'Failed to load tasks');
      setSchedules([]);
      setCompanyUsers(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadSchedules();

    // Listen for task updates and reload
    const handler = () => loadSchedules();
    window.addEventListener('tasks:updated', handler);
    return () => window.removeEventListener('tasks:updated', handler);
  }, [loadSchedules]);

  // Edit / Create handlers
  const openEdit = async (id: string) => {
    try {
      const resp = await api.get(`/job/schedule/${id}`);
      const data = resp.data || null;
      // Normalize assigned ids so AssigneePicker receives an array of ids
      try {
        const assigned = (data?.assigned_employees as Array<Record<string, unknown>> | undefined) || [];
        const assignedIds = assigned.map(a => Number(a.private_user_id ?? a.user_id ?? a.id)).filter(Boolean);
        const withIds = { ...(data || {}), assigned_employee_ids: assignedIds } as Record<string, unknown>;
        setEditData(withIds);
        try { setOriginalEditData(withIds ? JSON.parse(JSON.stringify(withIds)) : null); } catch { setOriginalEditData(withIds); }
      } catch {
        setEditData(data);
        try { setOriginalEditData(data ? JSON.parse(JSON.stringify(data)) : null); } catch { setOriginalEditData(data); }
      }
      // If we weren't able to load the full company list earlier, merge assigned_employees from the schedule so we can show names
      try {
        const assigned = (data?.assigned_employees as Array<Record<string, unknown>> | undefined) || [];
        if (assigned.length > 0) {
          if (!companyUsers) setCompanyUsers(assigned);
          else {
            const existingIds = new Set((companyUsers || []).map(c => {
              const rec = c as Record<string, any>;
              return String(rec.private_user?.private_user_id ?? rec.private_user_id ?? rec.user_id ?? rec.id ?? '');
            }));
            const merged = [...(companyUsers || [])];
            assigned.forEach(a => {
              const idStr = String(a.private_user_id ?? a.user_id ?? a.id ?? '');
              if (!existingIds.has(idStr)) merged.push(a);
            });
            setCompanyUsers(merged);
          }
        }
      } catch (err) {
        // ignore merge errors
      }
      // ensure company id is set and employees are loaded for the edit modal
      if (!companyIdState && (data as Record<string, unknown>)?.company_id) {
        const cid = Number((data as Record<string, unknown>)?.company_id);
        setCompanyIdState(cid);
        if (companyUsers === null) fetchCompanyUsers(cid);
      } else if (companyUsers === null && companyIdState) {
        fetchCompanyUsers();
      }

      setEditModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch schedule for edit', err);
      toast.error('Failed to load schedule for editing');
    }
  };

  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // Quick inline status change (for multi-assignee: any manager can mark complete)
  const [quickStatusTaskId, setQuickStatusTaskId] = useState<string | null>(null);

  const patchTaskStatus = async (id: string, newStatus: string) => {
    try {
      await api.put(`/job/schedule/${id}`, { status: newStatus });
      toast.success(`Task marked as ${newStatus}`);
      window.dispatchEvent(new Event('tasks:updated'));
    } catch (err) {
      console.error('Failed to update task status', err);
      toast.error('Failed to update status');
    } finally {
      setQuickStatusTaskId(null);
    }
  };
  
  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    
    // update status
    const newStatus = destination.droppableId;
    await patchTaskStatus(draggableId, newStatus);
  };

  const formatDateForInput = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(String(iso));
      // local tz ISO for datetime-local: YYYY-MM-DDTHH:mm
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  };
  const parseDateFromInput = (val: string) => {
    if (!val) return null;
    const d = new Date(val);
    return d.toISOString();
  };

  const saveEdit = async (payload: Record<string, unknown>) => {
    const p = payload as Record<string, unknown>;
    const id = String(p.schedule_id ?? p.id ?? '');
    if (!id) return;

    // ensure times are ISO strings if user provided datetime-local
    if ((p.start_time as unknown as string)?.length === 16) p.start_time = parseDateFromInput(p.start_time as string);
    if ((p.end_time as unknown as string)?.length === 16) p.end_time = parseDateFromInput(p.end_time as string);

    // #22 — additional pay: normalize blank → null (clears it), else a string.
    if ('additional_remuneration_amount' in p) {
      const amt = p.additional_remuneration_amount;
      p.additional_remuneration_amount = (amt === '' || amt == null || isNaN(Number(amt)) || Number(amt) <= 0) ? null : String(amt);
    }
    delete p.additional_duty_enabled;  // UI-only checkbox flag, not a backend field

    // validate required fields (location optional)
    const errs: Record<string, string> = {};
    if (!p.company_id && !companyIdState) errs.company_id = 'Company is required';
    if (!p.start_time) errs.start_time = 'Start time is required';
    if (!p.end_time) errs.end_time = 'End time is required';
    if (Object.keys(errs).length > 0) {
      setEditErrors(errs);
      toast.error('Please fill required fields');
      return;
    }

    // sanitize assigned_employee_ids: send empty array when none selected
    p.assigned_employee_ids = (Array.isArray(p.assigned_employee_ids) ? p.assigned_employee_ids : []).filter(id => {
      const uidStr = String(id);
      const found = (companyUsers || assigneeCandidates || []).find(c => {
        const rec = c as Record<string, any>;
        const cid = String(rec.private_user?.private_user_id ?? rec.private_user_id ?? rec.user_id ?? rec.id ?? '');
        return cid === uidStr;
      });
      return found ? isVerifiedUser(found) : false;
    });

    try {
      // Only send changed fields to backend to avoid unnecessary writes
      const updates: Record<string, unknown> = {};
      const original = originalEditData || {};
      Object.keys(p).forEach(k => {
        const pv = (p as any)[k];
        const ov = (original as any)[k];
        try {
          if (JSON.stringify(pv) !== JSON.stringify(ov)) updates[k] = pv;
        } catch {
          if (pv !== ov) updates[k] = pv;
        }
      });
      if (Object.keys(updates).length === 0) {
        toast.message('No changes to save');
        return;
      }
      // backend expects PUT for schedule updates; send minimized payload via PUT
      await api.put(`/job/schedule/${id}`, updates);
      toast.success('Task updated');
      window.dispatchEvent(new Event('tasks:updated'));
      setEditModalOpen(false);
      setEditData(null);
      setEditErrors({});
    } catch (err) {
      console.error('Failed to save schedule', err);
      toast.error('Failed to save task');
    }
  };

  const saveCreate = async (payload: Record<string, unknown>) => {
    const p = { ...(payload || {}) } as Record<string, unknown>;
    // ensure company_id present
    p.company_id = p.company_id ?? companyIdState ?? undefined;
    // ensure times are ISO strings
    if ((p.start_time as unknown as string)?.length === 16) p.start_time = parseDateFromInput(p.start_time as string);
    if ((p.end_time as unknown as string)?.length === 16) p.end_time = parseDateFromInput(p.end_time as string);

    // #22 — additional pay: omit when blank/invalid (empty string fails Decimal).
    const amt = p.additional_remuneration_amount;
    if (amt === '' || amt == null || isNaN(Number(amt)) || Number(amt) <= 0) {
      delete p.additional_remuneration_amount;
    } else {
      p.additional_remuneration_amount = String(amt);
    }
    delete p.additional_duty_enabled;  // UI-only checkbox flag, not a backend field

    // ensure title and location have values; backend requires both
    p.title = (p.title as string)?.trim() || 'Untitled Task';
    p.location = (p.location as string)?.trim() || 'TBD';

    const errs: Record<string, string> = {};
    if (!p.company_id) errs.company_id = 'Company is required';
    if (!p.start_time) errs.start_time = 'Start time is required';
    if (!p.end_time) errs.end_time = 'End time is required';
    if (Object.keys(errs).length > 0) {
      setCreateErrors(errs);
      toast.error('Please fill required fields');
      return;
    }

    // sanitize assigned_employee_ids: send empty array when none selected
    p.assigned_employee_ids = (Array.isArray(p.assigned_employee_ids) ? p.assigned_employee_ids : []).filter(id => {
      const uidStr = String(id);
      const found = (companyUsers || assigneeCandidates || []).find(c => {
        const rec = c as Record<string, any>;
        const cid = String(rec.private_user?.private_user_id ?? rec.private_user_id ?? rec.user_id ?? rec.id ?? '');
        return cid === uidStr;
      });
      return found ? isVerifiedUser(found) : false;
    });

    try {
      await api.post(`/job/schedule`, p);
      toast.success('Task created');
      window.dispatchEvent(new Event('tasks:updated'));
      setCreateModalOpen(false);
      setCreateErrors({});
    } catch (err) {
      console.error('Failed to create schedule', err);
      toast.error('Failed to create task');
    }
  };

  // #22 — "Additional duty" is an explicit checkbox; the amount field only
  // appears once it's ticked, so paid tasks are a conscious choice (matches PO).
  // Derived: ticked if the flag is set, or (for an existing task) an amount > 0.
  const isAdditionalDutyChecked = (d: Record<string, unknown> | null) =>
    Boolean((d?.additional_duty_enabled as boolean | undefined) ?? (Number(d?.additional_remuneration_amount) > 0));
  const toggleAdditionalDuty = (checked: boolean) =>
    setEditData(d => ({
      ...(d || {}),
      additional_duty_enabled: checked,
      ...(checked ? {} : { additional_remuneration_amount: '' }),  // unticking clears the amount
    }));

  // #22 — employer verifies a completed task → books additional remuneration
  // for each completed assignee (idempotent). Verify-before-pay gate.
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const handleVerifyPay = async (scheduleId: number) => {
    setVerifyingId(String(scheduleId));
    const r = await verifyScheduleCompletion(scheduleId);
    setVerifyingId(null);
    if ((r as { error?: string }).error) { toast.error((r as { error: string }).error); return; }
    const res = r as VerifyCompletionResult;
    if (res.paid_count > 0) {
      toast.success(`Paid ${res.paid_count} assignee${res.paid_count === 1 ? '' : 's'} · ${res.total_booked} total — added to payroll`);
    } else {
      toast.message('Nothing to pay — no newly-completed assignees');
    }
    window.dispatchEvent(new Event('tasks:updated'));
  };

  // derived data: unique assignees for filter
  const assignees = useMemo(() => {
    const set = new Map<string, string>();
    (schedules || []).forEach(s => {
      const rec = s as Record<string, unknown>;
      const assigned = rec.assigned_employees as Array<Record<string, unknown>> | undefined;
      if (assigned && Array.isArray(assigned)) {
        assigned.forEach(a => {
          const aRec = a as Record<string, unknown>;
          const id = String(aRec.private_user_id ?? '');
          const name = `${String((aRec.first_name ?? (aRec.private_user as any)?.first_name ?? ''))} ${String((aRec.last_name ?? (aRec.private_user as any)?.last_name ?? ''))}`.trim();
          if (id) set.set(id, name || id);
        });
      }
    });
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [schedules]);

  // filtered + searched schedules
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 250);
  const filtered = useMemo(() => {
    let list = schedules || [];
    if (statusFilter !== 'all') {
      list = list.filter(s => {
        const sRec = s as Record<string, unknown>;
        const st = String(sRec.status ?? sRec.state ?? 'pending');
        return st === statusFilter;
      });
    }
    if (assigneeFilter !== 'all') {
      list = list.filter(s => {
        const sRec = s as Record<string, unknown>;
        const assigned = (sRec.assigned_employees as Array<Record<string, unknown>> | undefined) || [];
        return assigned.some(a => String(a.private_user_id) === assigneeFilter);
      });
    }
    if (debouncedSearchTerm.trim()) {
      const q = debouncedSearchTerm.toLowerCase();
      list = list.filter(s => {
        const sRec = s as Record<string, unknown>;
        const t = String(sRec.title ?? sRec.job_title ?? '').toLowerCase();
        return t.includes(q);
      });
    }
    return list;
  }, [schedules, statusFilter, assigneeFilter, debouncedSearchTerm]);

  const totalPages = Math.max(1, Math.ceil((filtered || []).length / pageSize));
  const paginated = (filtered || []).slice((page - 1) * pageSize, page * pageSize);

  return (
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">
        <DashboardHeader
          title="Tasks"
          subtitle="One-off assignments with a status workflow — draft, pending, started, completed."
          icon={Target}
        />

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: schedules?.length || 0,                                                              iconBg: 'bg-gray-100',   iconText: 'text-gray-600',    Icon: Target },
            { label: 'Draft', value: schedules?.filter((s: any) => (s.status || s.state) === 'draft').length || 0,       iconBg: 'bg-gray-50',    iconText: 'text-gray-500',    Icon: Edit3 },
            { label: 'Pending', value: schedules?.filter((s: any) => (s.status || s.state) === 'pending').length || 0,   iconBg: 'bg-amber-50',   iconText: 'text-amber-600',   Icon: Clock },
            { label: 'In Progress', value: schedules?.filter((s: any) => (s.status || s.state) === 'started').length || 0, iconBg: 'bg-blue-50', iconText: 'text-blue-600',    Icon: Activity },
            { label: 'Completed', value: schedules?.filter((s: any) => (s.status || s.state) === 'completed').length || 0, iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', Icon: CheckCircle },
          ].map((stat) => (
            <div key={stat.label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-7 h-7 ${stat.iconBg} rounded-lg flex items-center justify-center`}>
                  <stat.Icon size={13} className={stat.iconText} />
                </div>
                <span className="text-xs font-medium text-gray-500">{stat.label}</span>
              </div>
              <p className="text-xl font-bold text-gray-900 tabular-nums">{loading ? '—' : stat.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Search tasks…"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              className="pl-9 pr-4 py-2 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-gray-400 transition-colors"
            />
          </div>

          <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5">
            {['all', 'draft', 'pending', 'started', 'completed'].map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s as any); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5 ml-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'kanban' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
            >
              Kanban
            </button>
          </div>

          <button
            onClick={() => { setStatusFilter('all'); setAssigneeFilter('all'); setSearchTerm(''); setPage(1); }}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Reset filters"
          >
            <RefreshCw size={14} />
          </button>

          <button
            onClick={async () => {
              setEditData({ assigned_employee_ids: [], title: '', status: 'draft' });
              if (!companyIdState) {
                if (authCompanyId) {
                  setCompanyIdState(authCompanyId);
                  fetchCompanyUsers(authCompanyId);
                } else {
                  const serverUser = await getCurrentUser();
                  if (!('error' in serverUser)) {
                    const sid = (serverUser as any)?.private_user?.company_id ??
                      (serverUser as any)?.private_user?.company?.company_id ??
                      (serverUser as any)?.company?.company_id ??
                      null;
                    if (sid) {
                      setCompanyIdState(sid);
                      fetchCompanyUsers(sid);
                    }
                  }
                }
              } else if (companyUsers === null && companyIdState) {
                fetchCompanyUsers();
              }
              setCreateModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            <Plus size={14} />
            New Task
          </button>
        </div>
        {/* Tasks View (List or Kanban) */}
        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
              <span className="text-sm text-gray-400">Loading tasks…</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
            <AlertTriangle size={15} className="shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : (filtered && filtered.length > 0) ? (
          viewMode === 'list' ? (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Task</th>
                      <th className="px-5 py-3.5 text-xs font-medium text-gray-500 hidden md:table-cell">Assigned To</th>
                      <th className="px-5 py-3.5 text-xs font-medium text-gray-500 hidden lg:table-cell">Assignee Progress</th>
                      <th className="px-5 py-3.5 text-xs font-medium text-gray-500 hidden sm:table-cell">Schedule</th>
                      <th className="px-5 py-3.5 text-xs font-medium text-gray-500">Status</th>
                      <th className="px-5 py-3.5 text-xs font-medium text-gray-500 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paginated.map((s, idx) => {
                      const sRec = s as Record<string, unknown>;
                      const key = String(sRec.id ?? sRec.schedule_id ?? idx);
                      const title = String(sRec.title ?? sRec.job_title ?? `Task #${key}`);
                      const assignedArr = (sRec.assigned_employees as Array<Record<string, unknown>> | undefined) || [];
                      const assigneeStatusesArr = (sRec.assignee_statuses as Array<{ private_user_id: number; status: string; note?: string | null; proof_image_url?: string | null; remuneration_one_off_id?: number | null }> | undefined) || [];
                      const completedCount = assigneeStatusesArr.filter(s => s.status === 'completed').length;
                      const totalAssigned = assignedArr.length;
                      // #22 — verify-and-pay is offered when the task carries
                      // additional pay and at least one completed assignee
                      // hasn't been paid yet (remuneration_one_off_id null).
                      const taskPay = Number(sRec.additional_remuneration_amount ?? 0);
                      const unpaidCompleted = assigneeStatusesArr.filter(s => s.status === 'completed' && (s.remuneration_one_off_id == null)).length;
                      const canVerifyPay = taskPay > 0 && unpaidCompleted > 0;
                      const status = String(sRec.status ?? sRec.state ?? 'pending');
                      const location = String(sRec.location ?? '');
                      const startTime = sRec.start_time
                        ? new Date(String(sRec.start_time)).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
                        : '—';

                      const statusStyles: Record<string, string> = {
                        draft:     'bg-gray-50 text-gray-500 border-gray-100',
                        pending:   'bg-amber-50 text-amber-700 border-amber-100',
                        started:   'bg-blue-50 text-blue-700 border-blue-100',
                        completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
                        cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
                      };

                      return (
                        <tr key={key} onClick={() => openEdit(key)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <td className="px-5 py-4">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</p>
                            {location && <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1"><MapPin size={10} />{location}</p>}
                            {sRec.notes ? (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1 line-clamp-1" title={String(sRec.notes)}>
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 shrink-0">Message:</span>
                                <span className="truncate">{String(sRec.notes)}</span>
                              </p>
                            ) : null}
                          </td>
                          <td className="px-5 py-4 hidden md:table-cell">
                            {assignedArr.length > 0 ? (
                              <div className="flex items-center gap-2">
                                <div className="flex -space-x-1">
                                  {assignedArr.slice(0, 3).map((a, i) => {
                                    const uid = Number((a as any).private_user_id);
                                    const empStatus = assigneeStatusesArr.find(s => s.private_user_id === uid)?.status ?? 'pending';
                                    const dotColor = empStatus === 'completed' ? 'bg-emerald-400' : empStatus === 'started' ? 'bg-blue-400' : 'bg-gray-300';
                                    return (
                                      <div key={i} className="relative w-6 h-6 rounded-full bg-gray-200 border border-white flex items-center justify-center text-[10px] font-semibold text-gray-700" title={`${String((a.first_name ?? (a.private_user as any)?.first_name ?? '?'))}: ${empStatus}`}>
                                        {String((a.first_name ?? (a.private_user as any)?.first_name ?? '?')).charAt(0)}
                                        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${dotColor}`} />
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500">{assignedArr.length} {assignedArr.length === 1 ? 'person' : 'people'}</span>
                                  {totalAssigned > 0 && assigneeStatusesArr.length > 0 && (
                                    <span className={`text-[10px] font-semibold ${completedCount === totalAssigned ? 'text-emerald-600' : 'text-gray-400'}`}>
                                      {completedCount}/{totalAssigned} done
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">Unassigned</span>
                            )}
                          </td>
                          <td className="px-5 py-4 hidden lg:table-cell">
                            {assigneeStatusesArr.length > 0 ? (
                              <div className="flex flex-col gap-1.5 min-w-[180px]">
                                {/* Cap the per-assignee rows: a task assigned to
                                    many people (e.g. a company-wide task) would
                                    otherwise render dozens of rows and blow up
                                    the table-row height, leaving a huge empty
                                    gap across the other columns. */}
                                {assigneeStatusesArr.slice(0, 5).map((as) => {
                                  const emp = assignedArr.find(a => Number((a as any).private_user_id) === as.private_user_id);
                                  const empName = String((emp as any)?.first_name ?? (emp as any)?.private_user?.first_name ?? `Employee #${as.private_user_id}`);
                                  const st = as.status;
                                  const stBadge = st === 'completed'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                    : st === 'started'
                                      ? 'bg-blue-50 text-blue-700 border-blue-100'
                                      : 'bg-gray-50 text-gray-500 border-gray-100';
                                  return (
                                    <div key={as.private_user_id} className="flex items-center gap-2">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize shrink-0 ${stBadge}`}>{st}</span>
                                      <span className="text-xs text-gray-600 dark:text-gray-300 truncate" title={as.note || empName}>{empName}</span>
                                      {as.note ? (
                                        <span className="text-[10px] text-gray-400 truncate max-w-[120px]" title={as.note}>
                                          “{String(as.note)}”
                                        </span>
                                      ) : null}
                                      {as.proof_image_url ? (
                                        <a href={String(as.proof_image_url)} target="_blank" rel="noopener noreferrer" className="shrink-0" title={`Photo proof from ${empName}`}>
                                          <span className="w-5 h-5 rounded-md overflow-hidden inline-block border border-gray-200 dark:border-gray-700">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={String(as.proof_image_url)} alt="Proof" className="w-full h-full object-cover" />
                                          </span>
                                        </a>
                                      ) : null}
                                    </div>
                                  );
                                })}
                                {assigneeStatusesArr.length > 5 && (
                                  <span className="text-[10px] text-gray-400">
                                    +{assigneeStatusesArr.length - 5} more
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">No progress reported</span>
                            )}
                          </td>
                          <td className="px-5 py-4 hidden sm:table-cell">
                            <div className="flex items-center gap-1.5 text-xs text-gray-500">
                              <Calendar size={11} />
                              {startTime}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border capitalize ${statusStyles[status] ?? statusStyles.pending}`}>
                              {status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="relative inline-flex items-center gap-1">
                              {canVerifyPay && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleVerifyPay(Number(sRec.schedule_id ?? sRec.id)); }}
                                  disabled={verifyingId === key}
                                  title={`Verify completion and pay ${taskPay} to ${unpaidCompleted} completed assignee${unpaidCompleted === 1 ? '' : 's'}`}
                                  className="h-8 inline-flex items-center gap-1 px-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  <CheckCircle size={12} />
                                  {verifyingId === key ? 'Paying…' : 'Verify & pay'}
                                </button>
                              )}
                              {status !== 'completed' && status !== 'cancelled' ? (
                                <div className="relative">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setQuickStatusTaskId(quickStatusTaskId === key ? null : key); }}
                                    className="h-8 flex items-center gap-0.5 px-2 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                    title="Change status"
                                  >
                                    <ArrowRightLeft size={12} />
                                    <ChevronDown size={10} />
                                  </button>
                                  {quickStatusTaskId === key && (
                                    <>
                                      <div className="fixed inset-0 z-40" onClick={() => setQuickStatusTaskId(null)} />
                                      <div className="absolute right-0 top-9 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden min-w-[140px]">
                                        {status !== 'started' && (
                                          <button onClick={() => patchTaskStatus(key, 'started')} className="w-full text-left px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                                            ▶ Mark Started
                                          </button>
                                        )}
                                        <button onClick={() => patchTaskStatus(key, 'completed')} className="w-full text-left px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                                          ✓ Mark Complete
                                        </button>
                                        {status !== 'pending' && (
                                          <button onClick={() => patchTaskStatus(key, 'pending')} className="w-full text-left px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                                            ↩ Revert to Pending
                                          </button>
                                        )}
                                        <button onClick={() => patchTaskStatus(key, 'cancelled')} className="w-full text-left px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 border-t border-gray-100 dark:border-gray-700 transition-colors">
                                          ✕ Cancel Task
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <button
                                  onClick={() => patchTaskStatus(key, 'pending')}
                                  className="h-8 flex items-center gap-1 px-2 text-xs font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                  title="Reopen task"
                                >
                                  <ArrowRightLeft size={12} />
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); openEdit(key); }}
                                className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                              >
                                <MoreVertical size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination (only in list view) */}
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-gray-500">
                  {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, (filtered || []).length)} of {(filtered || []).length} tasks
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1.5 text-xs text-gray-500">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Kanban View */
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex flex-row gap-6 overflow-x-auto pb-8 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent">
                {['draft', 'pending', 'started', 'completed', 'cancelled'].map((colStatus) => {
                  const colTasks = filtered.filter(s => {
                    const sRec = s as Record<string, unknown>;
                    const st = String(sRec.status ?? sRec.state ?? 'pending');
                    return st === colStatus;
                  });

                  const colStyles: Record<string, string> = {
                    draft:     'border-gray-200 bg-gray-50/50 text-gray-600',
                    pending:   'border-amber-200 bg-amber-50/30 text-amber-900',
                    started:   'border-blue-200 bg-blue-50/30 text-blue-900',
                    completed: 'border-emerald-200 bg-emerald-50/30 text-emerald-900',
                    cancelled: 'border-gray-200 bg-gray-50/30 text-gray-900',
                  };
                  
                  const dotStyles: Record<string, string> = {
                    draft:     'bg-gray-400',
                    pending:   'bg-amber-400',
                    started:   'bg-blue-400',
                    completed: 'bg-emerald-400',
                    cancelled: 'bg-gray-400',
                  };

                  return (
                    <div key={colStatus} className="flex-1 min-w-[320px] max-w-[420px] flex flex-col gap-4">
                      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${colStyles[colStatus]}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${dotStyles[colStatus]}`} />
                          <h3 className="text-sm font-bold capitalize">{colStatus}</h3>
                        </div>
                        <span className="text-xs font-bold opacity-60 bg-white/50 px-2 py-0.5 rounded-md">
                          {colTasks.length}
                        </span>
                      </div>

                      <Droppable droppableId={colStatus}>
                        {(provided, snapshot) => (
                          <div 
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                            className={`flex flex-col gap-3 min-h-[400px] p-1 rounded-2xl transition-colors ${snapshot.isDraggingOver ? 'bg-gray-100/50 dark:bg-gray-800/10' : ''}`}
                          >
                            {colTasks.length === 0 ? (
                              <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-2xl text-gray-400 bg-gray-50/30">
                                <p className="text-xs font-medium">No {colStatus} tasks</p>
                              </div>
                            ) : (
                              colTasks.map((s, idx) => {
                                const sRec = s as Record<string, unknown>;
                                const key = String(sRec.id ?? sRec.schedule_id ?? idx);
                                const title = String(sRec.title ?? sRec.job_title ?? `Task #${key}`);
                                const status = String(sRec.status ?? sRec.state ?? 'pending');
                                const location = String(sRec.location ?? '');
                                const assignedArr = (sRec.assigned_employees as Array<Record<string, unknown>> | undefined) || [];
                                const assigneeStatusesArr = (sRec.assignee_statuses as Array<{ private_user_id: number; status: string; note?: string | null; proof_image_url?: string | null }> | undefined) || [];
                                const startTime = sRec.start_time
                                  ? new Date(String(sRec.start_time)).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
                                  : 'No date';

                                return (
                                  <Draggable key={key} draggableId={key} index={idx}>
                                    {(provided, snapshot) => (
                                      <div 
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        onClick={() => openEdit(key)}
                                        className={`relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all group overflow-hidden cursor-pointer ${snapshot.isDragging ? 'shadow-2xl ring-2 ring-gray-900/5 scale-[1.02] z-50' : ''}`}
                                      >
                                        {/* Left accent bar */}
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${dotStyles[status]}`} />

                                        <div className="flex items-start justify-between gap-3 mb-2">
                                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                                            {title}
                                          </h4>
                                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button 
                                              onClick={(e) => { e.stopPropagation(); openEdit(key); }}
                                              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                              title="Edit Task"
                                            >
                                              <MoreVertical size={14} />
                                            </button>
                                          </div>
                                        </div>

                                        <div className="space-y-1.5 mb-4">
                                          {sRec.notes ? (
                                            <div className="flex items-start gap-2 text-[11px] text-gray-500" title={String(sRec.notes)}>
                                              <MessageSquare size={11} className="shrink-0 text-gray-400 mt-0.5" />
                                              <span className="line-clamp-2">{String(sRec.notes)}</span>
                                            </div>
                                          ) : null}
                                          {location && (
                                            <div className="flex items-center gap-2 text-[11px] text-gray-500">
                                              <MapPin size={11} className="shrink-0 text-gray-400" />
                                              <span className="truncate">{location}</span>
                                            </div>
                                          )}
                                          <div className="flex items-center gap-2 text-[11px] text-gray-500">
                                            <Calendar size={11} className="shrink-0 text-gray-400" />
                                            <span>{startTime}</span>
                                          </div>
                                        </div>

                                        {assigneeStatusesArr.length > 0 && (
                                          <div className="flex flex-col gap-1 mb-3">
                                            {/* Capped — see the list view: a task with many
                                                assignees would otherwise make the card very tall. */}
                                            {assigneeStatusesArr.slice(0, 5).map((as) => {
                                              const emp = assignedArr.find(a => Number((a as any).private_user_id) === as.private_user_id);
                                              const empName = String((emp as any)?.first_name ?? (emp as any)?.private_user?.first_name ?? `Employee #${as.private_user_id}`);
                                              const st = as.status;
                                              const stBadge = st === 'completed'
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                : st === 'started'
                                                  ? 'bg-blue-50 text-blue-700 border-blue-100'
                                                  : 'bg-gray-50 text-gray-500 border-gray-100';
                                              return (
                                                <div key={as.private_user_id} className="flex items-center gap-2">
                                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize shrink-0 ${stBadge}`}>{st}</span>
                                                  <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate" title={as.note || empName}>{empName}</span>
                                                  {as.note ? (
                                                    <span className="text-[10px] text-gray-400 truncate max-w-[100px]" title={as.note}>
                                                      “{String(as.note)}”
                                                    </span>
                                                  ) : null}
                                                  {as.proof_image_url ? (
                                                    <a href={String(as.proof_image_url)} target="_blank" rel="noopener noreferrer" className="shrink-0" title={`Photo proof from ${empName}`}>
                                                      <span className="w-5 h-5 rounded-md overflow-hidden inline-block border border-gray-200 dark:border-gray-700">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={String(as.proof_image_url)} alt="Proof" className="w-full h-full object-cover" />
                                                      </span>
                                                    </a>
                                                  ) : null}
                                                </div>
                                              );
                                            })}
                                            {assigneeStatusesArr.length > 5 && (
                                              <span className="text-[10px] text-gray-400">
                                                +{assigneeStatusesArr.length - 5} more
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        <div className="flex items-center justify-between pt-3 border-t border-gray-50 dark:border-gray-800/50">
                                          <div className="flex -space-x-1.5">
                                            {assignedArr.length > 0 ? (
                                              assignedArr.slice(0, 3).map((a, i) => (
                                                <div key={i} className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 border-2 border-white dark:border-gray-900 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-400" title={String(a.first_name || '?')}>
                                                  {String(a.first_name || '?').charAt(0)}
                                                </div>
                                              ))
                                            ) : (
                                              <div className="w-7 h-7 rounded-full bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 flex items-center justify-center">
                                                <Users size={10} className="text-gray-300 dark:text-gray-600" />
                                              </div>
                                            )}
                                            {assignedArr.length > 3 && (
                                              <div className="w-7 h-7 rounded-full bg-gray-50 dark:bg-gray-800 border-2 border-white dark:border-gray-900 flex items-center justify-center text-[9px] font-bold text-gray-500">
                                                +{assignedArr.length - 3}
                                              </div>
                                            )}
                                          </div>

                                          <div className="flex items-center gap-1.5">
                                            {status === 'draft' && (
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); patchTaskStatus(key, 'pending'); }}
                                                className="px-2.5 py-1.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-[10px] font-bold rounded-lg hover:bg-gray-800 dark:hover:bg-white transition-colors"
                                              >
                                                Publish
                                              </button>
                                            )}
                                            {status === 'pending' && (
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); patchTaskStatus(key, 'started'); }}
                                                className="px-2.5 py-1.5 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition-colors"
                                              >
                                                Start
                                              </button>
                                            )}
                                            {status === 'started' && (
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); patchTaskStatus(key, 'completed'); }}
                                                className="px-2.5 py-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-700 transition-colors"
                                              >
                                                Complete
                                              </button>
                                            )}
                                            {(status === 'completed' || status === 'cancelled') && (
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); patchTaskStatus(key, 'pending'); }}
                                                className="px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-[10px] font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                              >
                                                Reopen
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                );
                              })
                            )}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </div>
            </DragDropContext>
          )
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            {searchTerm || statusFilter !== 'all' ? (
              <EmptyState
                mode="no-results"
                icon={Target}
                title="No tasks match your filters"
                description="Try clearing the search box or switching the status filter back to All."
                actionLabel="Clear filters"
                onAction={() => { setSearchTerm(''); setStatusFilter('all'); }}
              />
            ) : (
              <EmptyState
                mode="no-data"
                icon={Target}
                title="No tasks yet"
                description="Create your first task to assign work and track progress."
                actionLabel="New task"
                onAction={async () => {
                  setEditData({ assigned_employee_ids: [], title: '', status: 'draft' });
                  if (companyIdState) fetchCompanyUsers();
                  setCreateModalOpen(true);
                }}
              />
            )}
          </div>
        )}

        {/* Edit Modal */}
        {editModalOpen && editData && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-xl max-h-[90vh] overflow-auto">
              <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between z-10">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Edit Task</h3>
                <button onClick={() => { setEditModalOpen(false); setEditData(null); }} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Task Title *</label>
                  <input
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors [color-scheme:light] dark:[color-scheme:dark]"
                    value={String(editData.title ?? editData.job_title ?? '')}
                    onChange={(e) => setEditData(d => ({ ...(d || {}), title: e.target.value }))}
                    placeholder="Enter task title"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Status</label>
                  <select
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-gray-400 text-sm bg-white dark:bg-gray-800 dark:text-white transition-colors"
                    value={String(editData.status ?? editData.state ?? 'pending')}
                    onChange={(e) => setEditData(d => ({ ...(d || {}), status: e.target.value }))}
                  >
                    <option value="draft">Draft</option>
                    <option value="pending">Pending</option>
                    <option value="started">Started</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Assign Employees</label>
                  {companyIdState !== null ? (
                    <>
                      {companyUsersLoading && <div className="flex items-center gap-2 text-xs text-gray-500 mb-2"><div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />Loading…</div>}
                      {companyUsersError && <div className="text-xs text-red-600 mb-2 p-2 bg-red-50 rounded-lg">{companyUsersError}</div>}
                      <AssigneePicker
                        companyId={companyIdState}
                        companyUsers={companyUsers}
                        selectedIds={(((editData?.assigned_employee_ids as unknown) as number[]) || [])}
                        onChange={(ids) => setEditData(d => ({ ...(d || {}), assigned_employee_ids: ids }))}
                      />
                    </>
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">No company available</div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Location</label>
                  <LocationPicker
                    value={String(editData?.location ?? '')}
                    lat={editData?.location_lat as number | undefined}
                    lng={editData?.location_lng as number | undefined}
                    onChange={(location, lat, lng) => setEditData(d => ({ ...(d || {}), location, location_lat: lat, location_lng: lng }))}
                    placeholder="Search for an address..."
                  />
                  {editErrors.location && <div className="text-xs text-red-600 mt-1">{editErrors.location}</div>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Message to assignees</label>
                  <textarea
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors resize-none"
                    value={String(editData?.notes ?? '')}
                    onChange={(e) => setEditData(d => ({ ...(d || {}), notes: e.target.value }))}
                    placeholder="Add instructions for the employees assigned to this task"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Start Time *</label>
                    <input type="datetime-local" className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors [color-scheme:light] dark:[color-scheme:dark]" value={formatDateForInput(editData?.start_time as string)} onChange={(e) => setEditData(d => ({ ...(d || {}), start_time: e.target.value }))} />
                    {editErrors.start_time && <div className="text-xs text-red-600 mt-1">{editErrors.start_time}</div>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">End Time *</label>
                    <input type="datetime-local" className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors [color-scheme:light] dark:[color-scheme:dark]" value={formatDateForInput(editData?.end_time as string)} onChange={(e) => setEditData(d => ({ ...(d || {}), end_time: e.target.value }))} />
                    {editErrors.end_time && <div className="text-xs text-red-600 mt-1">{editErrors.end_time}</div>}
                  </div>
                </div>
                {/* #22 — additional duty pay, gated by a checkbox (per assignee, paid on verify). */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                    <input type="checkbox" className="rounded border-gray-300 dark:border-gray-600" checked={isAdditionalDutyChecked(editData)} onChange={(e) => toggleAdditionalDuty(e.target.checked)} />
                    This is additional duty <span className="text-gray-400 font-normal">(extra pay)</span>
                  </label>
                  {isAdditionalDutyChecked(editData) && (
                    <div className="mt-2">
                      <input type="text" inputMode="decimal" autoFocus className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm tabular-nums transition-colors" value={String(editData?.additional_remuneration_amount ?? '')} onChange={(e) => setEditData(d => ({ ...(d || {}), additional_remuneration_amount: e.target.value }))} placeholder="Amount per assignee, e.g. 500.00" />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Each assignee earns this once you verify their completion. It lands on that month&apos;s payroll.</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-end gap-3">
                <button onClick={() => { setEditModalOpen(false); setEditData(null); }} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">Cancel</button>
                <button onClick={() => saveEdit(editData || {})} className="px-4 py-2 text-sm font-medium text-white dark:text-gray-900 bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-white rounded-lg transition-colors">Save Changes</button>
              </div>
            </div>
          </div>
        )}

        {/* Create Modal */}
        {createModalOpen && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-xl max-h-[90vh] overflow-auto">
              <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between z-10">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">New Task</h3>
                <button onClick={() => { setCreateModalOpen(false); setEditData(null); }} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Task Title *</label>
                  <input ref={createTitleRef} className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors [color-scheme:light] dark:[color-scheme:dark]" value={String(editData?.title ?? '')} onChange={(e) => setEditData(d => ({ ...(d || {}), title: e.target.value }))} placeholder="Enter task title" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Status</label>
                  <select className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-gray-400 text-sm bg-white dark:bg-gray-800 dark:text-white transition-colors" value={String(editData?.status ?? 'pending')} onChange={(e) => setEditData(d => ({ ...(d || {}), status: e.target.value }))}>
                    <option value="draft">Draft</option>
                    <option value="pending">Pending</option>
                    <option value="started">Started</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Assign Employees</label>
                  {companyIdState !== null ? (
                    <div>
                      {companyUsersLoading && <div className="flex items-center gap-2 text-xs text-gray-500 mb-2"><div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />Loading…</div>}
                      {companyUsersError && <div className="text-xs text-red-600 mb-2">{companyUsersError}</div>}
                      <AssigneePicker companyId={companyIdState} companyUsers={companyUsers} selectedIds={(((editData?.assigned_employee_ids as unknown) as number[]) || [])} onChange={(ids) => setEditData(d => ({ ...(d || {}), assigned_employee_ids: ids }))} />
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">No company available</div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Location</label>
                  <LocationPicker value={String(editData?.location ?? '')} lat={editData?.location_lat as number | undefined} lng={editData?.location_lng as number | undefined} onChange={(location, lat, lng) => setEditData(d => ({ ...(d || {}), location, location_lat: lat, location_lng: lng }))} placeholder="Search for an address..." />
                  {createErrors.location && <div className="text-xs text-red-600 mt-1">{createErrors.location}</div>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Message to assignees</label>
                  <textarea
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors resize-none"
                    value={String(editData?.notes ?? '')}
                    onChange={(e) => setEditData(d => ({ ...(d || {}), notes: e.target.value }))}
                    placeholder="Add instructions for the employees assigned to this task"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Start Time *</label>
                    <input type="datetime-local" className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors [color-scheme:light] dark:[color-scheme:dark]" value={formatDateForInput(editData?.start_time as string)} onChange={(e) => setEditData(d => ({ ...(d || {}), start_time: e.target.value }))} />
                    {createErrors.start_time && <div className="text-xs text-red-600 mt-1">{createErrors.start_time}</div>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">End Time *</label>
                    <input type="datetime-local" className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm transition-colors [color-scheme:light] dark:[color-scheme:dark]" value={formatDateForInput(editData?.end_time as string)} onChange={(e) => setEditData(d => ({ ...(d || {}), end_time: e.target.value }))} />
                    {createErrors.end_time && <div className="text-xs text-red-600 mt-1">{createErrors.end_time}</div>}
                  </div>
                </div>
                {/* #22 — additional duty pay, gated by an explicit checkbox so
                    a paid task is a conscious choice. Amount appears once ticked. */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                    <input type="checkbox" className="rounded border-gray-300 dark:border-gray-600" checked={isAdditionalDutyChecked(editData)} onChange={(e) => toggleAdditionalDuty(e.target.checked)} />
                    This is additional duty <span className="text-gray-400 font-normal">(extra pay)</span>
                  </label>
                  {isAdditionalDutyChecked(editData) && (
                    <div className="mt-2">
                      <input type="text" inputMode="decimal" autoFocus className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 text-sm tabular-nums transition-colors" value={String(editData?.additional_remuneration_amount ?? '')} onChange={(e) => setEditData(d => ({ ...(d || {}), additional_remuneration_amount: e.target.value }))} placeholder="Amount per assignee, e.g. 500.00" />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Each assignee earns this once you verify their completion. It lands on that month&apos;s payroll.</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-end gap-3">
                <button onClick={() => { setCreateModalOpen(false); setEditData(null); }} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">Cancel</button>
                <button onClick={() => saveCreate(editData || {})} className="px-4 py-2 text-sm font-medium text-white dark:text-gray-900 bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-white rounded-lg transition-colors">Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SolarisBackground>
  );
}

