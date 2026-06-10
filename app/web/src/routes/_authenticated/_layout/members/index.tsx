import { useState } from "react";
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { Mail, Search, UserPlus, UserCheck, Clock } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";

import { useMembers } from "@/hooks/useSocialData";
import { useHasRole } from "@/store/useAuthStore";
import { generateClient } from "aws-amplify/api";
import { inviteMember as inviteMemberMutation } from "@/api/appsync/social-mutation";

export const Route = createFileRoute("/_authenticated/_layout/members/")({
  component: MembersPage,
});

function MembersPage() {
  const q = useRouterState({
    select: (s) => (s.location.search as { q?: string }).q ?? "",
  }) as string;
  const [search, setSearch] = useState(q);
  const { data, loading, setData } = useMembers(search);
  const navigate = useNavigate();
  const canInvite = useHasRole("Admin", "MembershipAdmin");
  const [inviteOpen, setInviteOpen] = useState(false);

  const sendRequest = (id: string, name: string) => {
    setData((prev) =>
      (prev ?? []).map((m) =>
        m.id === id ? { ...m, connectionStatus: "pending_outgoing" } : m,
      ),
    );
    toast({
      title: "Invitation sent",
      description: `${name} will be notified.`,
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1128px] px-4 py-6 space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Members</h1>
            <p className="text-sm text-muted-foreground">
              Connect with peers. Contact details are shared only after a
              member accepts your request.
            </p>
          </div>
          {canInvite && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" /> Invite member
            </Button>
          )}
        </div>
        <div className="border-t border-border px-5 py-3">
          <div className="relative max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, title, or company"
              className="pl-9"
            />
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(data ?? []).map((m) => (
            <Card
              key={m.id}
              className="flex flex-col overflow-hidden text-center transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
            >
              <Link
                to="/members/$memberId"
                params={{ memberId: m.id }}
                className="block"
              >
                <div className="h-14 bg-gradient-to-br from-primary/85 to-primary" />
                <div className="-mt-8 flex flex-col items-center px-4">
                  <Avatar
                    name={m.name}
                    src={m.avatarUrl}
                    size="lg"
                    className="ring-4 ring-card"
                  />
                  <div className="mt-2 w-full">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {m.name}
                    </div>
                    {m.title && (
                      <div className="truncate text-xs text-muted-foreground">
                        {m.title}
                      </div>
                    )}
                    {m.company && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {m.company}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
              <CardContent className="mt-auto flex flex-col items-center gap-2 px-4 pb-4 pt-3">
                <ConnectionBadge status={m.connectionStatus} />
                <ConnectionAction
                  status={m.connectionStatus}
                  onConnect={() => sendRequest(m.id, m.name)}
                  onMessage={() =>
                    navigate({
                      to: "/members/$memberId",
                      params: { memberId: m.id },
                    })
                  }
                />
              </CardContent>
            </Card>
          ))}
          {(data ?? []).length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
              No members matched “{search}”.
            </p>
          )}
        </div>
      )}

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function InviteMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setNote("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const client = generateClient();
      await client.graphql({
        query: inviteMemberMutation,
        variables: {
          name: name.trim(),
          email: email.trim(),
          note: note.trim() || null,
        },
      });
      toast({
        title: "Invitation sent",
        description: `${name} will receive an email at ${email}.`,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e2 = err as any;
      const message =
        e2?.errors?.[0]?.message ?? e2?.message ?? "Failed to send invitation";
      toast({
        variant: "destructive",
        title: "Invite failed",
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Invite a new member
          </DialogTitle>
          <DialogDescription>
            We'll send a one-time invitation. The recipient completes sign-up
            and gains access to the Social Active App community.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Full name</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-note">Personal note (optional)</Label>
            <Textarea
              id="invite-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="We met last week at…"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionBadge({ status }: { status?: string }) {
  if (!status || status === "none") return <span className="h-5" aria-hidden />;
  if (status === "connected")
    return (
      <Badge variant="success" className="gap-1">
        <UserCheck className="h-3 w-3" /> Connected
      </Badge>
    );
  if (status === "pending_outgoing")
    return (
      <Badge variant="muted" className="gap-1">
        <Clock className="h-3 w-3" /> Pending
      </Badge>
    );
  if (status === "pending_incoming")
    return <Badge variant="warning">Wants to connect</Badge>;
  return null;
}

function ConnectionAction({
  status,
  onConnect,
  onMessage,
}: {
  status?: string;
  onConnect: () => void;
  onMessage: () => void;
}) {
  if (status === "connected") {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onMessage}
      >
        Message
      </Button>
    );
  }
  if (status === "pending_outgoing") {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled
      >
        Pending
      </Button>
    );
  }
  if (status === "pending_incoming") {
    return (
      <Button size="sm" className="w-full" onClick={onMessage}>
        Respond
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full gap-1.5"
      onClick={onConnect}
    >
      <UserPlus className="h-3.5 w-3.5" /> Connect
    </Button>
  );
}
