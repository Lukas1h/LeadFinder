import { redirect } from "next/navigation";
import { MAIN_SITE_URL } from "@/lib/siteUrls";

// Same as a dead gallery link: off to the business site.
export default function UploadNotFound() {
  redirect(MAIN_SITE_URL);
}
