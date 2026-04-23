import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, MapPin, Users, Star, Upload, Pencil } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";

import { CommentList } from "@/components/social/CommentList";
import { useEvent } from "@/hooks/useSocialData";
import { useAuthStore, useHasRole } from "@/store/useAuthStore";
import { formatEventDate } from "@/lib/time";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/_layout/events/$eventId")({
  component: EventDetailPage,
});

function EventDetailPage() {
  const { eventId } = Route.useParams();
  const { data, loading } = useEvent(eventId);
  const isAdmin = useHasRole("Admin");
  const user = useAuthStore((s) => s.user) ?? "";
  const [rating, setRating] = useState<number | null>(null);

  if (loading) return <Skeleton className="m-6 h-96 rounded-lg" />;
  if (!data)
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Event not found.</p>
        <Button variant="link" asChild>
          <Link to="/events">← Back to events</Link>
        </Button>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <Badge variant={data.status === "upcoming" ? "default" : "muted"}>
            {data.status === "upcoming" ? "Upcoming" : "Recorded"}
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatEventDate(data.startsAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {data.venue}
              {data.city ? `, ${data.city}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {data.rsvpCount} attending
            </span>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            {data.status === "past" && (
              <Button
                size="sm"
                onClick={() =>
                  toast({
                    title: "Upload video",
                    description: "Presigned PUT flow — wired once media construct is deployed.",
                  })
                }
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload video
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Video */}
      {data.status === "past" && data.videoUrl && (
        <div className="aspect-video overflow-hidden rounded-lg bg-black ring-1 ring-border">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={data.videoUrl}
            controls
            className="h-full w-full"
            poster={undefined}
          />
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">About this event</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">
            {data.description}
          </p>
        </CardContent>
      </Card>

      {/* Presenters */}
      {data.vendors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Presenting vendors</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {data.vendors.map((v) => (
              <Link
                key={v.id}
                to="/vendors/$vendorId"
                params={{ vendorId: v.id }}
                className="flex items-center gap-3 rounded-md border p-3 hover:border-primary/40 transition-colors"
              >
                <Avatar name={v.name} src={v.logoUrl} />
                <div className="min-w-0">
                  <div className="font-medium text-sm">{v.name}</div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Feedback (past events only) */}
      {data.status === "past" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Event feedback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              How satisfied were you with this event?
            </p>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  onClick={() => setRating(n)}
                  className="p-1 rounded hover:bg-accent"
                >
                  <Star
                    className={`h-5 w-5 ${
                      rating !== null && n <= rating
                        ? "fill-primary text-primary"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
            </div>
            {rating !== null && (
              <Button
                size="sm"
                onClick={() => {
                  // TODO: submitFeedback mutation
                  toast({ title: "Thanks!", description: "Feedback recorded." });
                  setRating(null);
                }}
              >
                Submit feedback
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Discussion */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Discussion</CardTitle>
        </CardHeader>
        <CardContent>
          <CommentList
            comments={data.comments ?? []}
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
