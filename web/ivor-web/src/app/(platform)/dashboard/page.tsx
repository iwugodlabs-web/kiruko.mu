"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import HomeSection from "./components/HomeSection";
import PlatformDashboard from "./components/PlatformDashboard";

export default function DashboardPage() {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !user?.isAuthenticated) {
            router.push('/');
        }
    }, [user, loading, router]);

    // Show loading while checking authentication
    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-gray-950">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4 mx-auto"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    // Redirect if not authenticated
    if (!user?.isAuthenticated) {
        return null;
    }

    // Platform admins see the Platform Dashboard
    if (user.isPlatformAdmin) {
        return <PlatformDashboard />;
    }

    // Company users see the regular HomeSection
    return <HomeSection />;
}
