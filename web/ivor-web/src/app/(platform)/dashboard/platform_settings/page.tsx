import { redirect } from "next/navigation";

// Platform Settings moved under /admin for path consistency with the rest of
// the platform-admin surface. Keep this redirect so old links/bookmarks work.
export default function Page() {
  redirect("/admin/platform-settings");
}
