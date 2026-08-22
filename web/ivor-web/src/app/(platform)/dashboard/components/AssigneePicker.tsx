"use client";

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { searchCompanyUsers } from '@/services/api';
import { Check, User, Search, X } from 'lucide-react';

type UserRec = Record<string, any>;

const isVerifiedUser = (u?: UserRec) => {
  if (!u) return false;
  if (u.user_verified === true) return true;
  if (u.private_user && (u.private_user.user_verified === true || u.private_user.verified === true)) return true;
  if (String(u.user_verified) === 'true') return true;
  return false;
};

export default function AssigneePicker({
  companyId,
  companyUsers,
  selectedIds,
  onChange,
  placeholder = 'Search or select employees...'
}: {
  companyId?: number | null;
  companyUsers?: UserRec[] | null;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState('');
  const [candidates, setCandidates] = useState<UserRec[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [showMore, setShowMore] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const runSearch = async (q: string) => {
    if (!companyId) return setCandidates(null);
    if (q.trim().length < 2) return setCandidates(null);
    setLoading(true);
    try {
      const res = await searchCompanyUsers(companyId, q, 50, 0);
      let normalized: UserRec[] | null = null;
      if (Array.isArray(res)) normalized = res.filter(isVerifiedUser);
      else if (res && typeof res === 'object' && !('error' in res)) normalized = [res].filter(isVerifiedUser);
      else normalized = null;
      setCandidates(normalized);
    } catch {
      setCandidates(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (!input || input.trim().length < 2) {
      setCandidates(null);
      setLoading(false);
      return;
    }
    timerRef.current = window.setTimeout(() => runSearch(input.trim()), 250) as unknown as number;
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [input]);

  // Use candidates if search was performed, otherwise use companyUsers
  const allList = (candidates || companyUsers || []);
  const filtered = allList.filter(u => {
    // Handle nested private_user structure
    const privateUser = u.private_user || u;
    const uid = String(privateUser.private_user_id ?? u.private_user_id ?? u.user_id ?? u.id ?? '');
    const firstName = String(privateUser.first_name ?? u.first_name ?? '');
    const lastName = String(privateUser.last_name ?? u.last_name ?? '');
    const name = `${firstName} ${lastName}`.toLowerCase().trim();
    const email = String(privateUser.email ?? u.email ?? '').toLowerCase();
    const q = input.toLowerCase().trim();
    if (q === '') return true;
    return name.includes(q) || uid.includes(q) || email.includes(q);
  }).slice(0, 20);

  const toggle = (uidNum: number) => {
    const s = selectedIds.map(String);
    const uid = String(uidNum);
    if (s.includes(uid)) onChange(selectedIds.filter(i => String(i) !== uid));
    else onChange(Array.from(new Set([...(selectedIds || []), uidNum])));
    setInput('');
    setCandidates(null);
    setHighlight(-1);
  };

  const clearAll = () => onChange([]);

  const nameFor = (id: number) => {
    const u = (companyUsers || candidates || []).find(x => String((x as any).private_user?.private_user_id ?? (x as any).private_user_id ?? (x as any).user_id ?? (x as any).id) === String(id));
    if (!u) return `Employee #${id}`;
    return `${String(u.first_name ?? u.private_user?.first_name ?? '')} ${String(u.last_name ?? u.private_user?.last_name ?? '')}`.trim() || `Employee #${id}`;
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Selected employees */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {selectedIds.slice(0, showMore ? selectedIds.length : 5).map(id => (
            <span key={String(id)} className="inline-flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-full text-sm">
              <User size={14} className="text-gray-500 dark:text-gray-400" />
              <span>{nameFor(id)}</span>
              <button onClick={() => toggle(Number(id))} className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors">
                <X size={14} />
              </button>
            </span>
          ))}
          {selectedIds.length > 5 && !showMore && (
            <button onClick={() => setShowMore(true)} className="inline-flex items-center px-3 py-1.5 rounded-full text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
              +{selectedIds.length - 5} more
            </button>
          )}
          {selectedIds.length > 5 && showMore && (
            <button onClick={() => setShowMore(false)} className="inline-flex items-center px-3 py-1.5 rounded-full text-sm bg-gray-200 hover:bg-gray-300 transition-colors">
              Show less
            </button>
          )}
          <button onClick={clearAll} className="text-sm text-red-600 hover:underline ml-2">Clear all</button>
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
        <input
          ref={inputRef}
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-gray-900 focus:border-gray-900 transition-all"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (highlight >= 0 && highlight < filtered.length) {
                const u = filtered[highlight] as Record<string, any>;
                const uid = Number(u.private_user?.private_user_id ?? u.private_user_id ?? u.user_id ?? u.id);
                if (uid) toggle(uid);
              }
            }
            if (e.key === 'ArrowDown') { setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
            if (e.key === 'ArrowUp') { setHighlight(h => Math.max(h - 1, 0)); }
            if (e.key === 'Escape') { setIsOpen(false); setInput(''); }
          }}
        />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg max-h-64 overflow-auto z-50">
          {loading && (
            <div className="flex items-center gap-2 p-4 text-gray-500 dark:text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              Searching...
            </div>
          )}

          {!loading && filtered.length === 0 && companyUsers === null && (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              <User className="mx-auto mb-2 text-gray-300 dark:text-gray-600" size={32} />
              <div>No employees loaded</div>
              <div className="text-xs mt-1">Employees will appear here once loaded</div>
            </div>
          )}

          {!loading && filtered.length === 0 && companyUsers !== null && (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              <div>No employees found</div>
              {input && <div className="text-xs mt-1">Try a different search term</div>}
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border-b dark:border-gray-800">
                {input ? `Search results (${filtered.length})` : `All employees (${filtered.length})`}
              </div>
              {filtered.map((u, idx) => {
                // Handle nested private_user structure
                const privateUser = u.private_user || u;
                const uid = String(privateUser.private_user_id ?? u.private_user_id ?? u.user_id ?? u.id ?? '');
                const firstName = String(privateUser.first_name ?? u.first_name ?? '');
                const lastName = String(privateUser.last_name ?? u.last_name ?? '');
                const name = `${firstName} ${lastName}`.trim();
                const email = privateUser.email ?? u.email ?? '';
                const selected = selectedIds.map(String).includes(uid);
                const highlighted = highlight === idx;
                return (
                  <button
                    key={uid || idx}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => toggle(Number(uid))}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${highlighted ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'} ${selected ? 'bg-green-50 dark:bg-green-950/40' : ''}`}
                  >
                    <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium text-sm">
                      {name ? name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white truncate">{name || email || 'Unknown'}</div>
                      {email && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{email}</div>}
                    </div>
                    {selected && <Check size={18} className="text-green-600 flex-shrink-0" />}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

