"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import Sidebar from "./dashboard/components/Sidebar";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { user, loading, logout } = useAuth();
    const router = useRouter();
    const isAuthenticated = !!user?.isAuthenticated;
    const handleIdle = useCallback(() => { logout(); }, [logout]);
    const { isWarning, secondsLeft, reset } = useIdleTimeout(handleIdle, isAuthenticated);

    // Redirect AFTER commit, not during render. Calling router.push() in the
    // render body of a client component races with React's state propagation:
    // a freshly logged-in user can land here on the very first render before
    // the AuthProvider has flushed setUser(...) into context, look unauthed,
    // and get bounced back to "/" — producing the "login works but doesn't
    // redirect" symptom. The effect waits a render past the auth state
    // update.
    useEffect(() => {
        if (!loading && !user?.isAuthenticated) {
            router.replace('/');
            return;
        }
        // Platform admins must not render the company dashboard — even via
        // client-side navigation that bypasses middleware. Mirror the server
        // guard so typing /dashboard/employees while signed in as platform admin
        // bounces to /admin.
        if (!loading && user?.isAuthenticated && user?.isPlatformAdmin) {
            router.replace('/admin');
        }
    }, [loading, user?.isAuthenticated, user?.isPlatformAdmin, router]);

    return (
        <div className="h-screen w-screen overflow-hidden bg-white dark:bg-gray-950">
            <div className="h-full w-full flex">
                {/* Mobile Menu Button */}
                <button
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white/90 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200/30"
                    aria-label="Toggle menu"
                >
                    <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>

                {/* Mobile Menu Overlay */}
                {isMobileMenuOpen && (
                    <div
                        className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
                        onClick={() => setIsMobileMenuOpen(false)}
                    />
                )}

                {/* Sidebar */}
                <div className={`
          fixed lg:static inset-y-0 left-0 z-50 lg:z-auto
          w-16 lg:w-auto h-full shrink-0
          transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
          transition-transform duration-300 ease-in-out
        `}>
                    <Sidebar />
                </div>

                <main className="flex-1 h-full overflow-y-auto overflow-x-hidden relative lg:ml-0">
                    <div className="h-full w-full pt-16 lg:pt-0">
                        <div className="mx-auto w-full max-w-7xl">
                            {children}
                        </div>
                    </div>
                </main>
            </div>
            {isWarning && isAuthenticated && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-6 max-w-sm w-full text-center">
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">Still there?</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">You will be signed out for inactivity in <b className="text-gray-900 dark:text-white tabular-nums">{secondsLeft}s</b>.</p>
                        <div className="mt-4 flex gap-2 justify-center">
                            <button onClick={reset} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black">Stay signed in</button>
                            <button onClick={() => logout()} className="px-4 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-semibold">Sign out now</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
