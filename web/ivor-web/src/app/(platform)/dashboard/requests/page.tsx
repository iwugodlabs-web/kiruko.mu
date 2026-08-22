"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — permanently redirected to /dashboard/leave */
export default function RequestsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/leave");
  }, [router]);
  return null;
}
