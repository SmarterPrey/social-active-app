import { useState } from "react";
import {
  createFileRoute,
  useNavigate,
  useRouter,
  Link,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";

import { useHasRole } from "@/store/useAuthStore";
import { useVendors } from "@/hooks/useSocialData";

export const Route = createFileRoute("/_authenticated/_layout/admin/events/new")({
  component: NewEventPage,
});

function NewEventPage() {
  const isAdmin = useHasRole("Admin");
  const navigate = useNavigate();
  const router = useRouter();
  const { data: vendors } = useVendors();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [sendInvites, setSendInvites] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-[1128px] px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Admin access required.
        </p>
      </div>
    );
  }

  const toggleVendor = (id: string) =>
    setVendorIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // TODO: wire AppSync `createEvent` mutation.
    await new Promise((r) => setTimeout(r, 400));
    toast({
      title: "Event created",
      description: sendInvites
        ? "Invite emails will be sent to all members."
        : "Saved as a draft; invites not sent.",
    });
    setSubmitting(false);
    navigate({ to: "/events" });
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-6 space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.history.back()}
        className="w-fit"
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
      </Button>

      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">New event</h1>
          <p className="text-sm text-muted-foreground">
            Schedule a session and attach sponsoring vendors. Members will be
            notified and can RSVP via their signed email link.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Q2 CISO Dinner — San Francisco"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                required
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What will members learn? Who's presenting?"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="startsAt">Starts</Label>
                <Input
                  id="startsAt"
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endsAt">Ends (optional)</Label>
                <Input
                  id="endsAt"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="venue">Venue</Label>
                <Input
                  id="venue"
                  required
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="Quince SF"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="San Francisco"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Sponsoring vendors</Label>
              <div className="flex flex-wrap gap-2">
                {(vendors ?? []).map((v) => {
                  const active = vendorIds.includes(v.id);
                  return (
                    <button
                      type="button"
                      key={v.id}
                      onClick={() => toggleVendor(v.id)}
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {v.name}
                    </button>
                  );
                })}
                {(vendors ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No vendors yet.{" "}
                    <Link
                      to="/admin/vendors/new"
                      className="text-primary hover:underline"
                    >
                      Add one
                    </Link>
                    .
                  </p>
                )}
              </div>
              {vendorIds.length > 0 && (
                <div className="pt-1 text-xs text-muted-foreground">
                  {vendorIds.length} selected
                  <Badge variant="muted" className="ml-2">
                    featured on event card
                  </Badge>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sendInvites}
                onCheckedChange={(c) => setSendInvites(c === true)}
              />
              <span>Send RSVP email invitations now</span>
            </label>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.history.back()}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create event"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
