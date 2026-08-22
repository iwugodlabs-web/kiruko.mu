"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newToast: Toast = {
      ...toast,
      id,
      duration: toast.duration ?? 5000
    };

    setToasts(prev => [...prev, newToast]);

    // Auto remove after duration
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, newToast.duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const success = useCallback((title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  }, [addToast]);

  const error = useCallback((title: string, message?: string) => {
    addToast({ type: 'error', title, message });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string) => {
    addToast({ type: 'warning', title, message });
  }, [addToast]);

  const info = useCallback((title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  }, [addToast]);

  const value: ToastContextType = {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
};

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
};

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove }) => {
  const { type, title, message, id } = toast;

  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info
  };

  // Colored border + text accents on a solid white/dark card (no light-only
  // tinted bg — that left dark text on a light box in dark mode).
  const colors = {
    success: 'border-green-200 dark:border-green-500/40 text-green-700 dark:text-green-300',
    error: 'border-red-200 dark:border-red-500/40 text-red-700 dark:text-red-300',
    warning: 'border-yellow-300 dark:border-yellow-500/40 text-yellow-700 dark:text-yellow-300',
    info: 'border-blue-200 dark:border-blue-500/40 text-blue-700 dark:text-blue-300'
  };

  const Icon = icons[type];

  return (
    <div className={`max-w-sm w-full bg-white dark:bg-zinc-900 shadow-lg rounded-lg border p-4 transform transition-all duration-300 ease-in-out ${colors[type]}`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <Icon className="h-6 w-6" />
        </div>
        <div className="ml-3 w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {message && (
            <p className="mt-1 text-sm opacity-90">{message}</p>
          )}
        </div>
        <div className="ml-4 flex-shrink-0 flex">
          <button
            onClick={() => onRemove(id)}
            className="inline-flex text-current hover:opacity-75 transition-opacity"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// Legacy support for existing emitToast function
export type LegacyToastType = "success" | "error";
export type LegacyToastItem = { id: number; message: string; type: LegacyToastType };

// Emit a toast from anywhere: emitToast(message, type)
export const emitToast = (message: string, type: LegacyToastType = "success") => {
  try {
    window.dispatchEvent(new CustomEvent("kontokaz-toast-add", { detail: { message, type } }));
  } catch {
    // noop in non-browser contexts
  }
};

export const LegacyToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<LegacyToastItem[]>([]);

  React.useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { message: string; type: LegacyToastType };
      const id = Date.now() + Math.random();
      const t: LegacyToastItem = { id, message: detail.message, type: detail.type || "success" };
      setToasts((s) => [...s, t]);
      setTimeout(() => setToasts((s) => s.filter(x => x.id !== id)), 3500);
    };
    window.addEventListener("kontokaz-toast-add", handler as EventListener);
    return () => window.removeEventListener("kontokaz-toast-add", handler as EventListener);
  }, []);

  return (
    <div className="fixed top-6 right-6 space-y-2 z-50">
      {toasts.map((t) => (
        <div key={t.id} className={`px-4 py-2 rounded-2xl shadow-md ${t.type === "success" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
};

export default ToastProvider;
