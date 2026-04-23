import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useVendors } from "@/hooks/useSocialData";
import { useHasRole } from "@/store/useAuthStore";

export const Route = createFileRoute("/_authenticated/_layout/vendors/")({
  component: VendorsPage,
});

function VendorsPage() {
  const { data, loading } = useVendors();
  const isAdmin = useHasRole("Admin");

  return (
    <div className="mx-auto w-full max-w-[1128px] px-4 py-6 space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Vendors</h1>
            <p className="text-sm text-muted-foreground">
              Sponsors presenting at our events. Tap a card for contact details.
            </p>
          </div>
          {isAdmin && (
            <Button asChild>
              <Link to="/admin/vendors/new">
                <Plus className="mr-1.5 h-4 w-4" /> New vendor
              </Link>
            </Button>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((v) => (
            <Link
              key={v.id}
              to="/vendors/$vendorId"
              params={{ vendorId: v.id }}
              className="group"
            >
              <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                <div className="h-16 bg-gradient-to-br from-primary/85 to-primary" />
                <div className="-mt-8 px-5">
                  <Avatar
                    name={v.name}
                    src={v.logoUrl}
                    size="lg"
                    className="ring-4 ring-card"
                  />
                </div>
                <CardHeader className="pb-2 pt-3">
                  <h3 className="truncate text-base font-semibold">{v.name}</h3>
                  {v.tagline && (
                    <p className="truncate text-xs text-muted-foreground">
                      {v.tagline}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex flex-wrap gap-1">
                    {v.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-[11px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
