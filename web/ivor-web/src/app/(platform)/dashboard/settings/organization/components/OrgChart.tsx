"use client";

import { Building2, Users } from "lucide-react";
import { OrgMember, OrgDepartment, getTier } from "./types";
import OrgNode from "./OrgNode";

interface Props {
  companyName: string;
  owners: OrgMember[];
  admins: OrgMember[];
  departments: OrgDepartment[];
}

// ─── Connector primitives ────────────────────────────────────────────────────

function VLine({ height = 24 }: { height?: number }) {
  return (
    <div
      className="w-px bg-gray-200 dark:bg-gray-700 mx-auto"
      style={{ height }}
    />
  );
}

/** Horizontal bar that spans its container + vertical drops at each end */
function BranchConnector({ count }: { count: number }) {
  if (count === 0) return null;
  if (count === 1) return <VLine />;
  return (
    <div className="relative flex justify-center">
      {/* vertical down from parent */}
      <VLine height={16} />
      {/* horizontal bar */}
      <div className="absolute top-4 left-0 right-0 h-px bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}

/** Row of nodes with vertical drops from a horizontal bar */
function NodeRow({
  members,
  size = "md",
}: {
  members: OrgMember[];
  size?: "sm" | "md";
}) {
  if (members.length === 0) return null;

  return (
    <div className="relative flex flex-col items-center">
      {members.length > 1 ? (
        // Horizontal bar + drops
        <div className="relative w-full flex flex-col items-center">
          <VLine height={16} />
          <div className="relative w-full flex justify-center">
            {/* horizontal connector spanning children */}
            <div
              className="absolute top-0 h-px bg-gray-200 dark:bg-gray-700"
              style={{
                // span from 1/2 of first child to 1/2 of last child
                left: `calc(50% - ${((members.length - 1) / members.length) * 50}%)`,
                right: `calc(50% - ${((members.length - 1) / members.length) * 50}%)`,
              }}
            />
            <div className="flex flex-wrap justify-center gap-3 relative z-10">
              {members.map((m) => (
                <div key={m.private_user_id} className="flex flex-col items-center">
                  <VLine height={16} />
                  <OrgNode member={m} size={size} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <VLine height={24} />
          <OrgNode member={members[0]} size={size} />
        </div>
      )}
    </div>
  );
}

// ─── Department group ────────────────────────────────────────────────────────

function DeptGroup({ dept }: { dept: OrgDepartment }) {
  const managers = dept.members.filter((m) => getTier(m.role) === "manager");
  const others = dept.members.filter((m) => getTier(m.role) !== "manager");

  return (
    <div className="flex flex-col items-center min-w-0">
      {/* Dept card */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
        <Building2 size={13} className="text-gray-400 shrink-0" />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
          {dept.name}
        </span>
        <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-md shrink-0">
          {dept.members.length}
        </span>
      </div>

      {dept.members.length === 0 && (
        <div className="mt-3 text-[10px] text-gray-300 dark:text-gray-600 italic">empty</div>
      )}

      {/* Managers row */}
      {managers.length > 0 && (
        <>
          <NodeRow members={managers} size="md" />
        </>
      )}

      {/* Employees row */}
      {others.length > 0 && (
        <>
          {managers.length > 0 ? (
            <div className="flex flex-col items-center">
              <VLine height={16} />
              <div className="flex flex-wrap justify-center gap-2">
                {others.map((m) => (
                  <div key={m.private_user_id} className="flex flex-col items-center">
                    <VLine height={12} />
                    <OrgNode member={m} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <NodeRow members={others} size="sm" />
          )}
        </>
      )}
    </div>
  );
}

// ─── Main chart ──────────────────────────────────────────────────────────────

export default function OrgChart({
  companyName,
  owners,
  admins,
  departments,
}: Props) {
  // No catch-all "Unassigned" department — there is no such department, so we
  // don't fabricate one. Employees without a department simply aren't shown
  // under one in the chart.
  const deptPlusUnassigned = [...departments];

  const hasAdmins = admins.length > 0;
  const hasDepts = deptPlusUnassigned.length > 0;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex flex-col items-center min-w-max mx-auto px-4">

        {/* ── Company root ── */}
        <div className="flex items-center gap-2.5 px-5 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl shadow-lg">
          <Building2 size={16} className="shrink-0" />
          <span className="text-sm font-bold">{companyName}</span>
        </div>

        {/* ── Owner tier ── */}
        {owners.length > 0 && (
          <NodeRow members={owners} size="md" />
        )}

        {/* ── Admin tier ── */}
        {hasAdmins && (
          <>
            {owners.length > 0 && <VLine height={owners.length > 0 ? 0 : 24} />}
            <NodeRow members={admins} size="md" />
          </>
        )}

        {/* ── Department tier ── */}
        {hasDepts && (
          <>
            <VLine height={24} />
            {deptPlusUnassigned.length === 1 ? (
              <DeptGroup dept={deptPlusUnassigned[0]} />
            ) : (
              <div className="relative flex flex-col items-center w-full">
                {/* horizontal bar spanning all dept groups */}
                <div className="relative w-full flex justify-center mb-0">
                  <div
                    className="absolute top-0 h-px bg-gray-200 dark:bg-gray-700"
                    style={{
                      left: `calc(50% - ${((deptPlusUnassigned.length - 1) / deptPlusUnassigned.length) * 50}%)`,
                      right: `calc(50% - ${((deptPlusUnassigned.length - 1) / deptPlusUnassigned.length) * 50}%)`,
                    }}
                  />
                  <div className="flex flex-wrap gap-8 justify-center relative z-10">
                    {deptPlusUnassigned.map((dept) => (
                      <div key={dept.department_id} className="flex flex-col items-center">
                        <VLine height={16} />
                        <DeptGroup dept={dept} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {owners.length === 0 && admins.length === 0 && deptPlusUnassigned.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-2 text-gray-400">
            <Users size={28} className="opacity-40" />
            <p className="text-sm">No employees to display.</p>
          </div>
        )}
      </div>
    </div>
  );
}
