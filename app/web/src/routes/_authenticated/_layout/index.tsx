import { useState } from "react";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { Calendar, Image, ListOrdered, Send, Users, Video } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";

import { FeedItemCard } from "@/components/social/FeedItemCard";
import { CommentList } from "@/components/social/CommentList";
import { useEvents, useFeed, useMembers } from "@/hooks/useSocialData";
import { useAuthStore } from "@/store/useAuthStore";
import { formatEventDate } from "@/lib/time";
import type { FeedItem } from "@/types/social";

export const Route = createFileRoute("/_authenticated/_layout/")({
  component: FeedPage,
});

function FeedPage() {
  // @ts-ignore — TanStack Router deep type instantiation
  const q = useRouterState({
    select: (s) => (s.location.search as { q?: string }).q ?? "",
  }) as string;
  const { data, loading, setData } = useFeed();
  const { data: events } = useEvents("upcoming");
  const { data: members } = useMembers("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [openThread, setOpenThread] = useState<FeedItem | null>(null);
  const [draft, setDraft] = useState("");
  const user = useAuthStore((s) => s.user) ?? "";

  const submitPost = () => {
    const body = draft.trim();
    if (!body) return;
    const optimistic: FeedItem = {
      id: `tmp-${Date.now()}`,
      kind: "member_post",
      authorId: "me",
      authorName: user || "You",
      body,
      createdAt: new Date().toISOString(),
      commentCount: 0,
      likeCount: 0,
      likedByMe: false,
    };
    setData((prev) => (prev ? [optimistic, ...prev] : [optimistic]));
    setDraft("");
    setComposerOpen(false);
    toast({ title: "Posted", description: "Your post is live on the feed." });
  };

  const toggleLike = (id: string) =>
    setData((prev) =>
      (prev ?? []).map((f) =>
        f.id === id
          ? {
              ...f,
              likedByMe: !f.likedByMe,
              likeCount: f.likeCount + (f.likedByMe ? -1 : 1),
            }
          : f,
      ),
    );

  const openItem = (id: string) => {
    const item = data?.find((f) => f.id === id) ?? null;
    setOpenThread(item);
  };

  const addComment = (body: string) => {
    if (!openThread) return;
    const c = {
      id: `cm-${Date.now()}`,
      authorId: "me",
      authorName: user || "You",
      body,
      createdAt: new Date().toISOString(),
    };
    const updated: FeedItem = {
      ...openThread,
      comments: [...(openThread.comments ?? []), c],
      commentCount: openThread.commentCount + 1,
    };
    setOpenThread(updated);
    setData((prev) => (prev ?? []).map((f) => (f.id === updated.id ? updated : f)));
  };

  const upcoming = (events ?? [])
    .filter((e) => e.status === "upcoming")
    .slice(0, 3);
  const memberCount = (members ?? []).length;

  const query = q.trim().toLowerCase();
  const visibleFeed = query
    ? (data ?? []).filter((f) => {
        const hay = [
          f.body,
          f.authorName,
          (f.comments ?? []).map((c) => c.body).join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(query);
      })
    : data;

  return (
    <div className="mx-auto w-full max-w-[1128px] px-4 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,225px)_minmax(0,1fr)_minmax(0,300px)]">
        {/* Left rail — profile summary */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-3">
            <Card className="overflow-hidden">
              <div className="h-14 bg-gradient-to-br from-primary/80 to-primary" />
              <div className="-mt-7 flex flex-col items-center px-4 pb-4 text-center">
                <Avatar
                  name={user || "You"}
                  size="lg"
                  className="ring-4 ring-card"
                />
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {user || "Welcome"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Social Active App member
                </div>
              </div>
              <div className="border-t border-border px-4 py-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Connections</span>
                  <span className="font-semibold text-primary">
                    {memberCount}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Upcoming events</span>
                  <span className="font-semibold text-primary">
                    {upcoming.length}
                  </span>
                </div>
              </div>
              <Link
                to="/settings"
                className="block border-t border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60"
              >
                View profile →
              </Link>
            </Card>

            <Card>
              <CardContent className="p-4 text-xs">
                <Link
                  to="/members"
                  className="flex items-center justify-between text-muted-foreground hover:text-primary"
                >
                  <span className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" /> Members directory
                  </span>
                  <span>→</span>
                </Link>
              </CardContent>
            </Card>
          </div>
        </aside>

        {/* Center — composer + feed */}
        <section className="space-y-3">
          <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
            <Card>
              <CardContent className="space-y-3 p-3">
                <div className="flex items-center gap-2">
                  <Avatar name={user || "You"} />
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/60 transition-colors"
                    >
                      Start a post
                    </button>
                  </DialogTrigger>
                </div>
                <div className="flex items-center justify-around">
                  <button
                    type="button"
                    onClick={() => setComposerOpen(true)}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60"
                  >
                    <Image className="h-4 w-4 text-[#378fe9]" aria-hidden />
                    Media
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerOpen(true)}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60"
                  >
                    <Video className="h-4 w-4 text-[#5f9b41]" aria-hidden />
                    Video
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerOpen(true)}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60"
                  >
                    <ListOrdered className="h-4 w-4 text-[#e06847]" aria-hidden />
                    Poll
                  </button>
                </div>
              </CardContent>
            </Card>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a post</DialogTitle>
                <DialogDescription>
                  Posts are visible to other members. Keep it professional.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3 pt-1">
                <Avatar name={user || "You"} />
                <div>
                  <div className="text-sm font-semibold">{user || "You"}</div>
                  <div className="text-xs text-muted-foreground">
                    Posting to all members
                  </div>
                </div>
              </div>
              <Textarea
                autoFocus
                rows={7}
                placeholder="What do you want to talk about?"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="resize-none border-0 shadow-none focus-visible:ring-0 text-base"
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setComposerOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={submitPost} disabled={!draft.trim()}>
                  <Send className="h-4 w-4 mr-1.5" /> Post
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="space-y-3">
            {loading && (
              <>
                <Skeleton className="h-36 rounded-lg" />
                <Skeleton className="h-36 rounded-lg" />
              </>
            )}
            {!loading && query && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Showing {(visibleFeed ?? []).length} of {(data ?? []).length}{" "}
                  posts matching <span className="font-medium">“{q}”</span>
                </span>
                <Link
                  to="."
                  search={{} as never}
                  className="font-medium text-primary hover:underline"
                >
                  Clear
                </Link>
              </div>
            )}
            {!loading &&
              (visibleFeed ?? []).map((item) => (
                <FeedItemCard
                  key={item.id}
                  item={item}
                  onToggleLike={toggleLike}
                  onOpen={openItem}
                />
              ))}
            {!loading && (visibleFeed ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-10">
                {query
                  ? `No posts matched “${q}”.`
                  : "No posts yet. Be the first."}
              </p>
            )}
          </div>
        </section>

        {/* Right rail — upcoming events */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-3">
            <Card>
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-base font-semibold">Upcoming events</h2>
                <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
              </div>
              <CardContent className="px-2 pb-3 pt-2">
                {upcoming.length === 0 && (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    Nothing on the calendar yet.
                  </p>
                )}
                <ul className="space-y-0.5">
                  {upcoming.map((e) => (
                    <li key={e.id}>
                      <Link
                        to="/events/$eventId"
                        params={{ eventId: e.id }}
                        className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
                      >
                        <span
                          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {e.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatEventDate(e.startsAt)} · {e.venue}
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/events"
                  className="mt-1 block rounded-md px-2 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-primary"
                >
                  All events →
                </Link>
              </CardContent>
            </Card>

            <div className="px-3 text-[11px] text-muted-foreground">
              Social Active App · Private network for security executives
            </div>
          </div>
        </aside>
      </div>

      <Dialog open={!!openThread} onOpenChange={(o) => !o && setOpenThread(null)}>
        <DialogContent className="max-w-xl">
          {openThread && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  {openThread.authorName}
                </DialogTitle>
                <DialogDescription className="whitespace-pre-wrap">
                  {openThread.body}
                </DialogDescription>
              </DialogHeader>
              <CommentList
                comments={openThread.comments ?? []}
                onAdd={addComment}
                currentUserName={user || "You"}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

