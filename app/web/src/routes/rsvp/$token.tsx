import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Calendar, Check, MapPin, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { formatEventDate } from "@/lib/time";

// Public RSVP route — NOT gated by _authenticated.
// Requires a signed token query param issued via email (see api/lambda/rsvp).

export const Route = createFileRoute("/rsvp/$token")({
  component: RsvpPage,
});

interface RsvpContext {
  event: {
    id: string;
    title: string;
    startsAt: string;
    endsAt?: string | null;
    venue: string;
    city?: string | null;
  };
  member: { id: string; name: string };
  rsvp: { id: string; status: "yes" | "no" | "pending"; guests: number };
}

function RsvpPage() {
  const { token } = Route.useParams();
  const [ctx, setCtx] = useState<RsvpContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attending, setAttending] = useState<boolean | null>(null);
  const [guests, setGuests] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    // TODO: call getRsvpByToken query (public API-key scope)
    //       client.graphql({ query: getRsvpByToken, variables: { token } })
    const id = setTimeout(() => {
      if (!token || token.length < 4) {
        setError("This invitation link is invalid or has expired.");
      } else {
        setCtx({
          event: {
            id: "e-001",
            title: "Q2 Executive Roundtable — Identity & the AI Workforce",
            startsAt: "2026-05-14T18:00:00-04:00",
            endsAt: "2026-05-14T21:00:00-04:00",
            venue: "The Pierre — 2 E 61st St",
            city: "New York, NY",
          },
          member: { id: "m-001", name: "Alex Chen" },
          rsvp: { id: "r-001", status: "pending", guests: 0 },
        });
      }
      setLoading(false);
    }, 150);
    return () => clearTimeout(id);
  }, [token]);

  const submit = () => {
    if (attending === null) return;
    // TODO: submitRsvp mutation (public API-key; token re-verified in resolver)
    toast({
      title: attending ? "RSVP confirmed" : "Thanks for letting us know",
      description: attending
        ? `You're down for ${ctx?.event.title}.`
        : "We hope to see you at the next one.",
    });
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-4">
        {loading && <Skeleton className="h-64 rounded-lg" />}
        {!loading && error && (
          <Card>
            <CardContent className="py-8 text-center space-y-2">
              <h1 className="text-lg font-semibold">Invitation not found</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        )}
        {!loading && ctx && !submitted && (
          <Card>
            <CardHeader>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Invitation for {ctx.member.name}
              </p>
              <CardTitle className="text-xl">{ctx.event.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {formatEventDate(ctx.event.startsAt)}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {ctx.event.venue}
                {ctx.event.city ? `, ${ctx.event.city}` : ""}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button
                  variant={attending === true ? "default" : "outline"}
                  onClick={() => setAttending(true)}
                >
                  <Check className="h-4 w-4 mr-1.5" /> I'll attend
                </Button>
                <Button
                  variant={attending === false ? "default" : "outline"}
                  onClick={() => {
                    setAttending(false);
                    setGuests(0);
                  }}
                >
                  Can't make it
                </Button>
              </div>

              {attending === true && (
                <div className="rounded-md border p-3 flex items-center justify-between">
                  <span className="text-sm">Additional guests</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => setGuests((g) => Math.max(0, g - 1))}
                      aria-label="Decrease guest count"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">
                      {guests}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => setGuests((g) => Math.min(5, g + 1))}
                      aria-label="Increase guest count"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                disabled={attending === null}
                onClick={submit}
              >
                Confirm RSVP
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                No sign-in required. This confirms on behalf of {ctx.member.name}.
              </p>
            </CardContent>
          </Card>
        )}
        {submitted && ctx && (
          <Card>
            <CardContent className="py-8 text-center space-y-3">
              <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Check className="h-5 w-5 text-primary" />
              </div>
              <h1 className="text-lg font-semibold">
                {attending ? "You're in." : "RSVP recorded."}
              </h1>
              <p className="text-sm text-muted-foreground">
                We've updated {ctx.member.name.split(" ")[0]}'s RSVP for{" "}
                {ctx.event.title}.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
