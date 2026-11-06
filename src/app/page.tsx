import type { Metadata } from "next";
import { StoreHome } from "./(store)/store-home";
import { storeContext, storeTenantId } from "./(store)/store-context";
import { StoreShell } from "./(store)/store-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (!(await storeTenantId())) return { title: "Accionahn" };
  return { title: (await storeContext()).tenant.name };
}

// `/` of every host. A tenant host (the middleware set x-tenant-id) shows that store's
// home; the agency host keeps a neutral page. The other store routes live in (store).
export default async function Home() {
  if (!(await storeTenantId())) return <main>Accionahn</main>;
  return (
    <StoreShell>
      <StoreHome />
    </StoreShell>
  );
}
