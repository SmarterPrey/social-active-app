import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, Mail, Phone } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";

import { CommentList } from "@/components/social/CommentList";
import { useVendor } from "@/hooks/useSocialData";
import { useAuthStore } from "@/store/useAuthStore";

export const Route = createFileRoute("/_authenticated/_layout/vendors/$vendorId")({
  component: VendorDetailPage,
});

const ROLE_LABEL = {
  sales: "Sales",
  technical_sales: "Technical sales",
} as const;

function VendorDetailPage() {
  const { vendorId } = Route.useParams();
  const { data, loading } = useVendor(vendorId);
  const user = useAuthStore((s) => s.user) ?? "";

  if (loading) return <Skeleton className="m-6 h-96 rounded-lg" />;
  if (!data)
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Vendor not found.</p>
        <Button variant="link" asChild>
          <Link to="/vendors">← Back to vendors</Link>
        </Button>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 space-y-6">
      <header className="flex items-start gap-4">
        <Avatar name={data.name} src={data.logoUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          {data.tagline && (
            <p className="text-sm text-muted-foreground">{data.tagline}</p>
          )}
          <div className="flex flex-wrap gap-1 pt-2">
            {data.tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>
        {data.website && (
          <Button asChild variant="outline" size="sm">
            <a href={data.website} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Website
            </a>
          </Button>
        )}
      </header>

      {data.presentationVideoUrl && (
        <div className="aspect-video overflow-hidden rounded-lg bg-black ring-1 ring-border">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={data.presentationVideoUrl} controls className="h-full w-full" />
        </div>
      )}

      {data.description && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">
              {data.description}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {data.contacts.map((c) => (
            <div key={c.id} className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{c.name}</span>
                <Badge variant="muted">{ROLE_LABEL[c.role]}</Badge>
              </div>
              <a
                href={`mailto:${c.email}`}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Mail className="h-3 w-3" /> {c.email}
              </a>
              {c.phone && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" /> {c.phone}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Member feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <CommentList
            comments={[]}
            onAdd={() =>
              toast({
                title: "Comment posted",
                description: "Wire createComment mutation to persist.",
              })
            }
            currentUserName={user || "You"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
