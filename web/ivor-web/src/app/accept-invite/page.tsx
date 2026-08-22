"use client";

import React, { use, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/services/apiClient";
import { AlertTriangle, ArrowRight, Lock, User, Loader2 } from "lucide-react";
import { toast } from "sonner";

function AcceptInviteContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get("token");

    const [verifying, setVerifying] = useState(true);
    const [valid, setValid] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inviteData, setInviteData] = useState<{ email: string; role: string } | null>(null);

    // Form state
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!token) {
            setVerifying(false);
            setError("Missing invitation token");
            return;
        }
        validateToken();
    }, [token]);

    const validateToken = async () => {
        try {
            const resp = await api.get(`/invite/validate/${token}`);
            if (resp.data.valid) {
                setValid(true);
                setInviteData({
                    email: resp.data.email,
                    role: resp.data.role
                });
            } else {
                setValid(false);
                setError(resp.data.error || "Invalid or expired invitation");
            }
        } catch (e: any) {
            setValid(false);
            setError("Failed to validate invitation. Please try again.");
            console.error(e);
        } finally {
            setVerifying(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            toast.error("Passwords do not match");
            return;
        }

        if (password.length < 8) {
            toast.error("Password must be at least 8 characters");
            return;
        }

        setSubmitting(true);
        try {
            await api.post("/invite/accept", {
                token,
                password,
                first_name: firstName || undefined,
                last_name: lastName || undefined
            });

            toast.success("Account created! Redirecting to login...");

            // Wait a moment before redirecting
            setTimeout(() => {
                router.push("/login"); // Or directly log them in if backend returns token
            }, 1500);
        } catch (e: any) {
            toast.error(e.response?.data?.detail || "Failed to create account");
        } finally {
            setSubmitting(false);
        }
    };

    if (verifying) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <Loader2 className="w-12 h-12 text-[#F2B705] animate-spin mb-4" />
                <p className="text-gray-600 font-medium">Verifying invitation...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertTriangle className="w-8 h-8 text-red-600" />
                    </div>
                    <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Invitation Error</h1>
                    <p className="text-gray-600 mb-8">{error}</p>
                    <button
                        onClick={() => router.push("/")}
                        className="w-full py-3 px-6 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-colors"
                    >
                        Go to Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-teal-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-500">
                <div className="p-8 lg:p-10">
                    <div className="text-center mb-10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/kiruko-mark.png" alt="Kiruko" className="w-16 h-16 object-contain mx-auto mb-6" />
                        <h1 className="font-display text-3xl font-black text-gray-900 mb-2 tracking-tight">Accept Invitation</h1>
                        <p className="text-gray-500">
                            Create your account to join as <span className="font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded-lg">{inviteData?.role}</span>
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Account</label>
                            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-3">
                                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-gray-400 border border-gray-100 font-bold">
                                    {inviteData?.email?.[0].toUpperCase()}
                                </div>
                                <span className="text-gray-600 font-medium truncate">{inviteData?.email}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">First Name</label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                    <input
                                        type="text"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all font-medium"
                                        placeholder="John"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Last Name</label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                    <input
                                        type="text"
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all font-medium"
                                        placeholder="Doe"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Set Password</label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all font-medium"
                                    placeholder="Min. 8 characters"
                                    required
                                    minLength={8}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Confirm Password</label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all font-medium"
                                    placeholder="Re-enter password"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-4 bg-gray-900 hover:bg-black text-white rounded-xl font-bold text-lg shadow-xl shadow-gray-900/20 hover:shadow-2xl hover:shadow-gray-900/40 transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 group"
                        >
                            {submitting ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : (
                                <>
                                    Complete Setup <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>
                </div>
                <div className="bg-gray-50 p-6 text-center text-sm text-gray-500 border-t border-gray-100">
                    By clicking &quot;Complete Setup&quot;, you agree to our{" "}
                    <Link href="/terms" className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">
                        Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">
                        Privacy Policy
                    </Link>
                    .
                </div>
            </div>
        </div>
    );
}

export default function AcceptInvitePage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <Loader2 className="w-12 h-12 text-[#F2B705] animate-spin mb-4" />
            </div>
        }>
            <AcceptInviteContent />
        </Suspense>
    );
}
