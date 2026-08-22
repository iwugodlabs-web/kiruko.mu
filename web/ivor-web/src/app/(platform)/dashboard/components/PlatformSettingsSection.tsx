"use client";

import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { Settings, Shield, Zap, Globe, Bell } from "lucide-react";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";

export default function PlatformSettingsSection() {
  const { user } = useAuth();

  return (
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto space-y-6 py-8 px-6">
        <DashboardHeader
          title="Platform Settings"
          subtitle="Global system configuration"
          icon={Settings}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-400 shrink-0">
                <Shield size={18} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Platform Security</h3>
                <p className="text-xs text-gray-400 mb-3">Manage authentication policies and role-based access control.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-5">Configure global authentication policies, access control rules, and audit log retention settings.</p>
                <div className="flex items-center gap-2">
                  <button disabled className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 text-sm font-medium rounded-lg cursor-not-allowed">Configure</button>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 text-xs font-medium text-amber-600 dark:text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Coming Soon</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
                <Zap size={18} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Integrations</h3>
                <p className="text-xs text-gray-400 mb-3">Third-party services and API webhooks.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-5">Connect external services, configure API webhooks, and manage third-party workforce tools.</p>
                <div className="flex items-center gap-2">
                  <button disabled className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 text-sm font-medium rounded-lg cursor-not-allowed">Manage APIs</button>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 text-xs font-medium text-amber-600 dark:text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Coming Soon</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 shrink-0">
                <Globe size={18} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Regional Settings</h3>
                <p className="text-xs text-gray-400 mb-3">Timezone, currency and localisation preferences.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-5">Define timezone defaults, currency formats, and localisation preferences for the platform.</p>
                <div className="flex items-center gap-2">
                  <button disabled className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 text-sm font-medium rounded-lg cursor-not-allowed">Adjust</button>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 text-xs font-medium text-amber-600 dark:text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Coming Soon</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600 shrink-0">
                <Bell size={18} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Notifications</h3>
                <p className="text-xs text-gray-400 mb-3">Platform-wide alerts and notification templates.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-5">Broadcast platform-wide updates and manage system-level notification templates and preferences.</p>
                <div className="flex items-center gap-2">
                  <button disabled className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 text-sm font-medium rounded-lg cursor-not-allowed">Configure</button>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 text-xs font-medium text-amber-600 dark:text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Coming Soon</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SolarisBackground>
  );
}
