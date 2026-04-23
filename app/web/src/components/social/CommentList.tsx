import { useState } from "react";
import { Send } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "@/lib/time";
import type { Comment } from "@/types/social";

interface Props {
  comments: Comment[];
  onAdd?: (body: string) => void;
  currentUserName?: string;
}

export function CommentList({ comments, onAdd, currentUserName }: Props) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd?.(trimmed);
    setDraft("");
  };

  return (
    <div className="space-y-4">
      {comments.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet — start the conversation.</p>
      )}
      {comments.map((c) => (
        <div key={c.id} className="flex gap-3">
          <Avatar name={c.authorName} src={c.authorAvatarUrl} size="sm" />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{c.authorName}</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(c.createdAt)}
              </span>
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">{c.body}</p>
          </div>
        </div>
      ))}
      {onAdd && (
        <div className="flex gap-3 pt-2 border-t border-border/60">
          <Avatar name={currentUserName ?? "You"} size="sm" />
          <div className="flex-1 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={submit} disabled={!draft.trim()}>
                <Send className="h-3.5 w-3.5 mr-1.5" /> Post
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
