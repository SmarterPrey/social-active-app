import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, MapPin, Users, Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

import { useEvents } from "@/hooks/useSocialData";
import { useHasRole } from "@/store/useAuthStore";
import { formatEventDate } from "@/lib/time";
import type { EventItem, EventStatus } from "@/types/social";

export const Route = createFileRoute("/_authenticated/_layout/events/")({
  component: EventsPage,
});

function EventsPage() {
  const [tab, setTab] = useState<EventStatus>("upcoming");
  const isAdmin = useHasRole("Admin");

  return (
    <div className="mx-auto w-full max-w-[1128px] px-4 py-6 space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Events</h1>
            <p className="text-sm text-muted-foreground">
              Upcoming sessions and past recordings.
            </p>
          </div>
          {isAdmin && (
            <Button asChild>
              <Link to="/admin/events/new">New event</Link>
            </Button>
          )}
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as EventStatus)}
          className="w-full"
        >
          <TabsList className="w-full justify-start rounded-none border-t border-border bg-transparent p-0">
            <TabsTrigger
              value="upcoming"
              className="relative rounded-none border-b-2 border-transparent bg-transparent px-5 py-3 text-sm font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              Upcoming
            </TabsTrigger>
            <TabsTrigger
              value="past"
              className="relative rounded-none border-b-2 border-transparent bg-transparent px-5 py-3 text-sm font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              Past
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="p-4 pt-4">
            <EventGrid status="upcoming" />
          </TabsContent>
          <TabsContent value="past" className="p-4 pt-4">
            <EventGrid status="past" />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

function EventGrid({ status }: { status: EventStatus }) {
  const { data, loading } = useEvents(status);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-44 rounded-lg" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No {status} events.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
    </div>
  );
}

function EventCard({ event }: { event: EventItem }) {
  const day = new Date(event.startsAt).toLocaleDateString("en-US", {
    day: "2-digit",
  });
  const month = new Date(event.startsAt)
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();

  return (
    <Link to="/events/$eventId" params={{ eventId: event.id }} className="group block">
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
        <div className="flex h-20 items-center gap-3 bg-gradient-to-br from-primary/90 to-primary px-4 text-primary-foreground">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-card text-card-foreground shadow-sm">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {month}
            </span>
            <span className="text-xl font-bold leading-none">{day}</span>
          </div>
          <div className="min-w-0 flex-1">
            {event.status === "past" && event.videoUrl ? (
              <Badge variant="muted" className="gap-1 bg-white/90 text-foreground">
                <Video className="h-3 w-3" /> Recording
              </Badge>
            ) : (
              <Badge variant="muted" className="bg-white/90 text-foreground">
                Upcoming
              </Badge>
            )}
          </div>
        </div>
        <CardHeader className="pb-2 pt-3">
          <h3 className="text-base font-semibold leading-tight line-clamp-2">
            {event.title}
          </h3>
        </CardHeader>
        <CardContent className="space-y-1.5 text-[13px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            <span>{formatEventDate(event.startsAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">
              {event.venue}
              {event.city ? `, ${event.city}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5" aria-hidden />
            <span>
              {event.rsvpCount} attending · {event.guestCount} guests
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
