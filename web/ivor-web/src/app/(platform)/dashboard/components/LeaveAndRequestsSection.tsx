"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Leaves from "./Leaves";
import Complaints from "./Complaints";
import Support from "./Support";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";
import { FileText, MessageSquare, ShieldQuestion, RefreshCw } from "lucide-react";


export default function LeaveAndRequestsSection() {
  const { user } = useAuth();
  const isPlatformAdmin = !!(user?.isPlatformAdmin);
  // M4 — the Concerns tab is for company admins handling their own employees'
  // grievances; platform admins should still see it for cross-customer ops.
  // Support remains platform-admin-only.
  const isCompanyAdmin = !!(user?.isCompanyAdmin);
  const canSeeConcerns = isPlatformAdmin || isCompanyAdmin;

  const [activeTab, setActiveTab] = useState<"leaves" | "complaints" | "support">("leaves");
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // If the active tab is restricted but the user doesn't have access, reset to leaves.
  const safeActiveTab =
    (!canSeeConcerns && activeTab === "complaints") || (!isPlatformAdmin && activeTab === "support")
      ? "leaves"
      : activeTab;

  return (
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">
        <DashboardHeader
          title="Leave"
          subtitle="Review and action leave requests, complaints, and support tickets."
          extra={
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-gray-600 dark:text-gray-400 text-sm font-medium transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          }
        >
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5 w-fit mt-4">
            <button
              onClick={() => setActiveTab("leaves")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-150 ${safeActiveTab === "leaves"
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-900"
                }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Leaves
            </button>
            {canSeeConcerns && (
              <button
                onClick={() => setActiveTab("complaints")}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-150 ${safeActiveTab === "complaints"
                  ? "bg-gray-900 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
                  }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Concerns
              </button>
            )}
            {isPlatformAdmin && (
              <button
                onClick={() => setActiveTab("support")}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-150 ${safeActiveTab === "support"
                  ? "bg-gray-900 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
                  }`}
              >
                <ShieldQuestion className="w-3.5 h-3.5" />
                Support
              </button>
            )}
          </div>
        </DashboardHeader>

        <div>
          {safeActiveTab === "leaves" && <Leaves refreshKey={refreshKey} />}
          {safeActiveTab === "complaints" && canSeeConcerns && <Complaints refreshKey={refreshKey} />}
          {safeActiveTab === "support" && isPlatformAdmin && <Support refreshKey={refreshKey} />}
        </div>
      </div>
    </SolarisBackground>
  );
}
