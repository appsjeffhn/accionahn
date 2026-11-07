import "server-only";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { requirePanelSession } from "@/lib/auth/panel-session";
import { ForbiddenError, type Session } from "@/lib/auth/session";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";
import { InsufficientStockError, StockNotTrackedError } from "@/lib/stock/stock";
import { InUseError } from "@/lib/store/setup";
import { failed, type FormState } from "./form-state";

// Every panel page and server action calls this itself (the layout alone is not enough).
// The tenant is the one of the session, which requirePanelSession has matched to the host.
export async function panelSession(): Promise<{ session: Session; tenantId: string }> {
  const session = await requirePanelSession((await headers()).get(TENANT_ID_HEADER) ?? "");
  if (!session.tenantId) throw new ForbiddenError();
  return { session, tenantId: session.tenantId };
}

// Known failures of a save or delete as a form error; anything else is logged (name and
// code only) and shown as a generic failure.
export function failure(error: unknown): FormState {
  if (error instanceof InUseError) return failed({ _form: "inUse" });
  if (error instanceof ForbiddenError) return failed({ _form: "forbidden" });
  if (error instanceof InsufficientStockError) return failed({ _form: "insufficientStock" });
  if (error instanceof StockNotTrackedError) return failed({ _form: "notTracked" });
  if (error instanceof RangeError) return failed({ value: "stockValue" });
  if (error instanceof ZodError) return failed({ _form: "invalid" });
  const e = error as { name?: string; code?: string };
  console.error("panel save failed", e?.name, e?.code);
  return failed({ _form: "failed" });
}
