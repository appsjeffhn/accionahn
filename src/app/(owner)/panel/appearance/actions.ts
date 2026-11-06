"use server";

import { revalidatePath } from "next/cache";
import { listOwnerCatalog } from "@/lib/catalog/catalog";
import { parseAppearanceForm, saveAppearance } from "@/lib/store/appearance";
import { LOGO_MAX_BYTES } from "@/lib/store/assets";
import { failed, saved, type FormState } from "../form-state";
import { failure, panelSession } from "../session";

// The tenant comes from the panel session; the form never names a tenant or a logo path.
export async function saveAppearanceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, tenantId } = await panelSession();
  const { draft, removeLogo } = parseAppearanceForm(fd);

  const file = fd.get("logo");
  let logo: Uint8Array | null = null;
  if (file instanceof File && file.size > 0) {
    // size checked before reading the bytes; the type is checked from the bytes themselves
    if (file.size > LOGO_MAX_BYTES) return failed({ logo: "logoSize" });
    logo = new Uint8Array(await file.arrayBuffer());
  }

  try {
    const catalog = await listOwnerCatalog(session, tenantId);
    const result = await saveAppearance(session, { draft, logo, removeLogo, current: catalog.settings?.theme });
    if (!result.ok) return failed(result.errors);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/appearance");
  return saved();
}
