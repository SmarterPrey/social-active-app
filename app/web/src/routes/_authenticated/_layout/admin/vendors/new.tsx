import { useState } from "react";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";

import { useHasRole } from "@/store/useAuthStore";

export const Route = createFileRoute("/_authenticated/_layout/admin/vendors/new")({
  component: NewVendorPage,
});

interface Contact {
  name: string;
  role: "sales" | "technical_sales";
  email: string;
  phone: string;
}

function emptyContact(): Contact {
  return { name: "", role: "sales", email: "", phone: "" };
}

function NewVendorPage() {
  const isAdmin = useHasRole("Admin");
  const navigate = useNavigate();
  const router = useRouter();

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([emptyContact()]);
  const [submitting, setSubmitting] = useState(false);

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-[1128px] px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const updateContact = (i: number, patch: Partial<Contact>) =>
    setContacts((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  const removeContact = (i: number) =>
    setContacts((prev) => prev.filter((_, idx) => idx !== i));
  const addContact = () => setContacts((prev) => [...prev, emptyContact()]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // TODO: wire AppSync `createVendor` mutation.
    await new Promise((r) => setTimeout(r, 400));
    toast({
      title: "Vendor created",
      description: `${name} is now available to feature in events.`,
    });
    setSubmitting(false);
    navigate({ to: "/vendors" });
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
          <h1 className="text-xl font-semibold tracking-tight">New vendor</h1>
          <p className="text-sm text-muted-foreground">
            Contacts remain hidden from members until a member connects with the
            vendor's listed team.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Company name</Label>
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tagline">Tagline</Label>
                <Input
                  id="tagline"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">About</Label>
              <Textarea
                id="description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tags">Tags (comma separated)</Label>
              <Input
                id="tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="SIEM, DLP, Identity"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Contacts</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addContact}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add contact
                </Button>
              </div>
              <div className="space-y-3">
                {contacts.map((c, i) => (
                  <div
                    key={i}
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
                  >
                    <Input
                      placeholder="Name"
                      required
                      value={c.name}
                      onChange={(e) =>
                        updateContact(i, { name: e.target.value })
                      }
                    />
                    <select
                      value={c.role}
                      onChange={(e) =>
                        updateContact(i, {
                          role: e.target.value as Contact["role"],
                        })
                      }
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="sales">Sales</option>
                      <option value="technical_sales">Technical sales</option>
                    </select>
                    <Input
                      type="email"
                      placeholder="Email"
                      required
                      value={c.email}
                      onChange={(e) =>
                        updateContact(i, { email: e.target.value })
                      }
                    />
                    <div className="flex gap-2">
                      <Input
                        type="tel"
                        placeholder="Phone (optional)"
                        value={c.phone}
                        onChange={(e) =>
                          updateContact(i, { phone: e.target.value })
                        }
                      />
                      {contacts.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeContact(i)}
                          aria-label="Remove contact"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.history.back()}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create vendor"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
