"use client";

import Link from "next/link";
import { OrgMember, getTier, TIER_BADGE, TIER_AVATAR, TIER_LABEL } from "./types";

interface Props {
  member: OrgMember;
  size?: "sm" | "md";
}

export default function OrgNode({ member, size = "md" }: Props) {
  const tier = getTier(member.role);
  const initials = `${member.first_name?.[0] ?? ""}${member.last_name?.[0] ?? ""}`.toUpperCase();
  const fullName = `${member.first_name} ${member.last_name}`.trim();

  if (size === "sm") {
    return (
      <Link
        href={`/dashboard/employees/${member.user_id}`}
        className="group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500 hover:shadow-sm transition-all min-w-[80px] max-w-[96px]"
        title={fullName}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${TIER_AVATAR[tier]}`}>
          {initials || "?"}
        </div>
        <div className="text-center">
          <p className="text-[10px] font-medium text-gray-800 dark:text-gray-200 truncate w-full leading-tight">
            {member.first_name}
          </p>
          <p className="text-[9px] text-gray-400 dark:text-gray-500 truncate w-full">{member.last_name}</p>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/dashboard/employees/${member.user_id}`}
      className="group flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500 hover:shadow-md transition-all min-w-[120px] max-w-[140px]"
      title={fullName}
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${TIER_AVATAR[tier]}`}>
        {initials || "?"}
      </div>
      <div className="text-center space-y-0.5 w-full">
        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{fullName}</p>
        {member.job_title && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{member.job_title}</p>
        )}
        <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-md mt-1 ${TIER_BADGE[tier]}`}>
          {TIER_LABEL[tier]}
        </span>
      </div>
    </Link>
  );
}
