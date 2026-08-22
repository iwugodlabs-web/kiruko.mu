"use client";

import React from 'react';

export default function SolarisBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full overflow-y-auto bg-white dark:bg-gray-950">
      {children}
    </div>
  );
}
