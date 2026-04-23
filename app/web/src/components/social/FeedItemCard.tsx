import { Link } from "@tanstack/react-router";
import { Heart, MessageSquare, Store, Video } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { FeedItem } from "@/types/social";
import { formatDistanceToNow } from "@/lib/time";

interface Props {
  item: FeedItem;
  onToggleLike?: (id: string) => void;
  onOpen?: (id: string) => void;
}

export function FeedItemCard({ item, onToggleLike, onOpen }: Props) {
  return (
    <Card className="transition-colors hover:border-primary/30">
      <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
        <Avatar name={item.authorName} src={item.authorAvatarUrl} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">
              {item.authorName ?? "Event team"}
            </span>
            {item.kind === "system_new_vendor" && (
              <Badge variant="muted" className="gap-1">
                <Store className="h-3 w-3" /> New vendor
              </Badge>
            )}
            {item.kind === "system_new_event_video" && (
              <Badge variant="muted" className="gap-1">
                <Video className="h-3 w-3" /> Event recording
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDistanceToNow(item.createdAt)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
          {item.body}
        </p>
        {item.linkedVendorId && (
          <Link
            to="/vendors/$vendorId"
            params={{ vendorId: item.linkedVendorId }}
            className="inline-block text-xs text-primary hover:underline"
          >
            View vendor profile →
          </Link>
        )}
        {item.linkedEventId && (
          <Link
            to="/events/$eventId"
            params={{ eventId: item.linkedEventId }}
            className="inline-block text-xs text-primary hover:underline"
          >
            Watch the recording →
          </Link>
        )}
        <div className="flex items-center gap-2 pt-2 border-t border-border/60">
          <Button
            variant="ghost"
            size="sm"
            className={item.likedByMe ? "text-primary" : ""}
            onClick={() => onToggleLike?.(item.id)}
          >
            <Heart
              className={`h-4 w-4 mr-1.5 ${item.likedByMe ? "fill-current" : ""}`}
            />
            {item.likeCount}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen?.(item.id)}
          >
            <MessageSquare className="h-4 w-4 mr-1.5" />
            {item.commentCount}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
