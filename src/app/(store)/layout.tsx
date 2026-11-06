import type { ReactNode } from "react";
import type { Metadata } from "next";
import { storeContext } from "./store-context";
import { StoreShell } from "./store-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { tenant } = await storeContext();
  return { title: { default: tenant.name, template: `%s · ${tenant.name}` } };
}

// Store pages of a tenant host. StoreShell applies the tenant theme (CSS variables, logo)
// itself, so `/` (src/app/page.tsx), which renders StoreShell outside this group, gets it too.
export default function StoreLayout({ children }: { children: ReactNode }) {
  return <StoreShell>{children}</StoreShell>;
}
