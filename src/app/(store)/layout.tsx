import type { ReactNode } from "react";
import type { Metadata } from "next";
import { storeContext } from "./store-context";
import { StoreShell } from "./store-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { tenant } = await storeContext();
  return { title: { default: tenant.name, template: `%s · ${tenant.name}` } };
}

// Store pages of a tenant host. The tenant theme (Task 11) is passed to StoreShell as
// CSS variables; until then the defaults of store.css apply.
export default function StoreLayout({ children }: { children: ReactNode }) {
  return <StoreShell>{children}</StoreShell>;
}
