import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Check, Lock, Mail, Phone, UserPlus, X } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";

import { useMember } from "@/hooks/useSocialData";

export const Route = createFileRoute("/_authenticated/_layout/members/$memberId")({
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const { memberId } = Route.useParams();
  const { data, loading, setData } = useMember(memberId);

  if (loading) return <Skeleton className="m-6 h-80 rounded-lg" />;
  if (!data)
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Member not found.</p>
        <Button variant="link" asChild>
          <Link to="/members">← Back to members</Link>
        </Button>
      </div>
    );

  const connected = data.connectionStatus === "connected";
  const outgoing = data.connectionStatus === "pending_outgoing";
  const incoming = data.connectionStatus === "pending_incoming";

  const updateStatus = (status: typeof data.connectionStatus) =>
    setData((prev) => (prev ? { ...prev, connectionStatus: status } : prev));

  const request = () => {
    updateStatus("pending_outgoing");
    // TODO: requestConnection mutation
    toast({ title: "Request sent", description: `${data.name} will be notified.` });
  };
  const respond = (accept: boolean) => {
    updateStatus(accept ? "connected" : "none");
    // TODO: respondToConnection mutation
    toast({
      title: accept ? "Connected" : "Declined",
      description: accept
        ? `You and ${data.name} can now see each other's contact details.`
        : "Request dismissed.",
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-6">
      <header className="flex items-start gap-4">
        <Avatar name={data.name} src={data.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          {data.title && (
            <div className="text-sm text-muted-foreground">{data.title}</div>
          )}
          {data.company && (
            <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {data.company}
            </div>
          )}
        </div>
        <div>
          {connected && <Badge variant="success">Connected</Badge>}
          {outgoing && (
            <Badge variant="muted">Request pending</Badge>
          )}
          {!connected && !outgoing && !incoming && (
            <Button size="sm" onClick={request}>
              <UserPlus className="h-4 w-4 mr-1.5" /> Request to connect
            </Button>
          )}
          {incoming && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => respond(true)}>
                <Check className="h-4 w-4 mr-1.5" /> Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => respond(false)}>
                <X className="h-4 w-4 mr-1.5" /> Decline
              </Button>
            </div>
          )}
        </div>
      </header>

      {data.bio && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">
              {data.bio}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Contact
            {!connected && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {connected ? (
            <>
              {data.email && (
                <a
                  href={`mailto:${data.email}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Mail className="h-3.5 w-3.5" /> {data.email}
                </a>
              )}
              {data.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {data.phone}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Contact details are shared once {data.name.split(" ")[0]} accepts your
              request.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
