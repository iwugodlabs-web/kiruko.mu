"use client";

import { useState } from "react";
import { ArrowLeft, Edit, Power, PowerOff, Save, X } from "lucide-react";
import ActionGroup from "@/app/components/ActionGroup";
import ManageUsersButton from "./ManageUsersButton";

type Employer = {
  id: number;
  name: string;
  email: string;
  active: boolean;
  totalSalaryPaid: number;
  totalTaxes: number;
  numEmployees: number;
  // This employer's operating currency (derived from its country). Per-employer,
  // since this is a single-company detail view — falls back to the MUR symbol
  // ("Rs") only when the caller doesn't supply it.
  currency?: string;
  onboarding?: {
    status: "Not Started" | "Pending" | "Completed";
    startDate?: string;
  };
};

type Props = {
  employer: Employer;
  goBack: () => void;
};

export default function EmployerDetails({ employer, goBack }: Props) {
  const [isActive, setIsActive] = useState(employer.active);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({
    name: employer.name,
    email: employer.email,
  });

  // Currency label for this employer's figures — its own currency, or the MUR
  // symbol as a last resort.
  const ccy = employer.currency || "Rs";

  const onboardingProgress =
    employer.onboarding?.status === "Completed"
      ? 100
      : employer.onboarding?.status === "Pending"
      ? 60
      : 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSave = () => {
    setIsEditing(false);
  };

  return (
    <div className="p-6 w-full bg-white dark:bg-gray-900 min-h-screen text-gray-900 dark:text-white rounded-xl shadow-sm border border-gray-200 dark:border-gray-800">
      {/* Back Button */}
      <button
        onClick={goBack}
        className="flex items-center mb-4 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors text-sm"
      >
        <ArrowLeft className="mr-2 w-5 h-5 text-gray-700 dark:text-gray-200" /> Back to Employers
      </button>

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{form.name}</h2>
        <div className="flex gap-3">
          <div className="flex items-center gap-3">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Edit className="w-4 h-4 mr-2" /> Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Save className="w-4 h-4 mr-2" /> Save
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setForm({ name: employer.name, email: employer.email });
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-4 h-4 mr-2 text-gray-700 dark:text-gray-200" /> Cancel
                </button>
              </>
            )}

            <button
              onClick={() => setIsActive((s) => !s)}
              className="flex items-center px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            >
              {isActive ? (
                <>
                  <PowerOff className="w-4 h-4 mr-2 text-red-600" /> Deactivate
                </>
              ) : (
                <>
                  <Power className="w-4 h-4 mr-2 text-green-600" /> Activate
                </>
              )}
            </button>

            <ActionGroup
              onView={() => {}}
              onEdit={() => setIsEditing(true)}
              onDelete={() => {}}
            />

            {/* Manage users (visible to owner or superuser or company admin) */}
            <ManageUsersButton employerId={employer.id} />
          </div>
        </div>
      </div>

      {/* Employer Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Company Info</h3>

          {isEditing ? (
            <>
              <label className="block mb-2 text-sm text-gray-600 dark:text-gray-400">Name</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                className="w-full mb-3 p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
              />
              <label className="block mb-2 text-sm text-gray-600 dark:text-gray-400">Email</label>
              <input
                name="email"
                value={form.email}
                onChange={handleChange}
                className="w-full mb-3 p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
              />
              <p className="text-sm text-gray-600 dark:text-gray-400">Employees: {employer.numEmployees}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Status: {isActive ? "Active" : "Inactive"}</p>
            </>
          ) : (
            <>
              <p className="text-gray-700 dark:text-gray-200"><strong>Email:</strong> {form.email}</p>
              <p className="text-gray-700 dark:text-gray-200"><strong>Status:</strong> {isActive ? "Active" : "Inactive"}</p>
              <p className="text-gray-700 dark:text-gray-200"><strong>Employees:</strong> {employer.numEmployees}</p>
              <p className="text-gray-600 dark:text-gray-400"><strong>Onboarding:</strong> {employer.onboarding?.status}</p>
            </>
          )}
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Financial Overview</h3>
          <p className="text-gray-700 dark:text-gray-200">Total Salary Paid: {ccy} {employer.totalSalaryPaid.toLocaleString()}</p>
          <p className="text-gray-700 dark:text-gray-200">Total Taxes: {ccy} {employer.totalTaxes.toLocaleString()}</p>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Onboarding Progress</h3>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className="bg-gray-900 dark:bg-gray-100 h-3 rounded-full transition-all"
              style={{ width: `${onboardingProgress}%` }}
            ></div>
          </div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{onboardingProgress}% completed</p>
          {employer.onboarding?.startDate && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Started: {employer.onboarding.startDate}</p>
          )}
        </div>
      </div>
    </div>
  );
}
