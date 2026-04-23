import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User, Shield, Sun, Moon, Monitor } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useTheme } from "@/components/theme-provider";
import { useAuthStore } from "@/store/useAuthStore";
import {
  deleteUserAttributes,
  fetchAuthSession,
  fetchUserAttributes,
  updateUserAttributes,
} from "aws-amplify/auth";

export const Route = createFileRoute("/_authenticated/_layout/settings")({
  component: Settings,
});

type ProfileAttributeKey =
  | "given_name"
  | "family_name"
  | "address"
  | "nickname"
  | "phone_number"
  | "website"
  | "custom:organization";

type ProfileFieldConfig = {
  key: ProfileAttributeKey;
  label: string;
  description: string;
  placeholder: string;
  autoComplete?: string;
  type?: "text" | "tel" | "url";
  fullWidth?: boolean;
  size?: number;
};

type ProfileFormValues = Record<ProfileAttributeKey, string>;

const PROFILE_FIELDS: ReadonlyArray<ProfileFieldConfig> = [
  {
    key: "given_name",
    label: "First Name",
    description: "",
    placeholder: "Jane",
    autoComplete: "given-name",
    size: 100,
  },
  {
    key: "family_name",
    label: "Last Name",
    description: "",
    placeholder: "Doe",
    autoComplete: "family-name",
    size: 100,
  },
  {
    key: "nickname",
    label: "Display Name (Visible before connection)",
    description: "",
    placeholder: "jdoe",
    autoComplete: "nickname",
    size: 100,
  },
  {
    key: "phone_number",
    label: "Phone",
    description: "",
    placeholder: "+12065550123",
    autoComplete: "tel",
    type: "tel",
    size: 16,
  },
  {
    key: "website",
    label: "Website",
    description: "",
    placeholder: "https://example.com",
    autoComplete: "url",
    type: "url",
    size: 50,
  },
  {
    key: "custom:organization",
    label: "Organization",
    description: "",
    placeholder: "Example Corp",
    autoComplete: "organization",
    size: 100,
  },
  {
    key: "address",
    label: "Shipping Address",
    description: "",
    placeholder: "123 Main St, Seattle, WA 98101",
    autoComplete: "street-address",
    fullWidth: true,
  },
];

const EMPTY_PROFILE_VALUES: ProfileFormValues = {
  given_name: "",
  family_name: "",
  address: "",
  nickname: "",
  phone_number: "",
  website: "",
  "custom:organization": "",
};

function mapAttributesToFormValues(
  attrs: Partial<Record<ProfileAttributeKey | "email", string>>
): ProfileFormValues {
  return {
    given_name: attrs.given_name ?? "",
    family_name: attrs.family_name ?? "",
    address: attrs.address ?? "",
    nickname: attrs.nickname ?? "",
    phone_number: attrs.phone_number ?? "",
    website: attrs.website ?? "",
    "custom:organization": attrs["custom:organization"] ?? "",
  };
}

function normalizeProfileValues(values: ProfileFormValues): ProfileFormValues {
  return {
    given_name: values.given_name.trim(),
    family_name: values.family_name.trim(),
    address: values.address.trim(),
    nickname: values.nickname.trim(),
    phone_number: values.phone_number.trim(),
    website: values.website.trim(),
    "custom:organization": values["custom:organization"].trim(),
  };
}

function getProfileValidationError(values: ProfileFormValues): string | null {
  if (values.phone_number && !/^\+[1-9]\d{1,14}$/.test(values.phone_number)) {
    return "Phone number must use E.164 format, for example +12065550123.";
  }

  if (values.website) {
    try {
      const url = new URL(values.website);
      if (!url.protocol.startsWith("http")) {
        return "Website must start with http:// or https://.";
      }
    } catch {
      return "Website must be a valid URL.";
    }
  }

  return null;
}

function formatAttributeLabel(attributeKey: string): string {
  const field = PROFILE_FIELDS.find((item) => item.key === attributeKey);
  return field?.label ?? attributeKey;
}

function Settings() {
  const { theme, setTheme, syncing } = useTheme();
  const roles = useAuthStore((s) => s.roles);
  const { toast } = useToast();
  const [email, setEmail] = useState<string | null>(null);
  const [profileValues, setProfileValues] =
    useState<ProfileFormValues>(EMPTY_PROFILE_VALUES);
  const [initialProfileValues, setInitialProfileValues] =
    useState<ProfileFormValues>(EMPTY_PROFILE_VALUES);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileAttributeKey, string>>>({});

  useEffect(() => {
    const loadIdentity = async () => {
      setIdentityLoading(true);
      try {
        try {
          const attrs = await fetchUserAttributes();
          const nextValues = mapAttributesToFormValues(
            attrs as Partial<Record<ProfileAttributeKey | "email", string>>
          );
          setProfileValues(nextValues);
          setInitialProfileValues(nextValues);
          if (attrs.email) {
            setEmail(attrs.email);
            return;
          }
        } catch {
          // Fall through to token lookup for email.
        }

        try {
          const session = await fetchAuthSession();
          const tokenEmail = session.tokens?.idToken?.payload?.email as
            | string
            | undefined;
          setEmail(tokenEmail ?? null);
        } catch {
          setEmail(null);
        }
      } finally {
        setIdentityLoading(false);
      }
    };

    loadIdentity();
  }, []);

  const isIdentityDirty = PROFILE_FIELDS.some(
    ({ key }) => profileValues[key] !== initialProfileValues[key]
  );

  const validateField = (key: ProfileAttributeKey, value: string): string | null => {
    if (key === "phone_number" && value && !/^\+[1-9]\d{1,14}$/.test(value)) {
      return "E.164 format required, e.g. +12065550123";
    }
    if (key === "website" && value) {
      try {
        const url = new URL(value);
        if (!url.protocol.startsWith("http")) return "Must start with http:// or https://";
      } catch {
        return "Enter a valid URL";
      }
    }
    return null;
  };

  const updateProfileValue = (key: ProfileAttributeKey, value: string) => {
    setProfileValues((current) => ({ ...current, [key]: value }));
    const err = validateField(key, value);
    setFieldErrors((current) => {
      if (err) return { ...current, [key]: err };
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleIdentityReset = () => {
    setProfileValues(initialProfileValues);
  };

  const handleIdentitySave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (Object.keys(fieldErrors).length > 0) {
      toast({ variant: "destructive", title: "Fix validation errors before saving." });
      return;
    }

    const normalizedValues = normalizeProfileValues(profileValues);
    const normalizedInitialValues = normalizeProfileValues(initialProfileValues);
    const validationError = getProfileValidationError(normalizedValues);

    if (validationError) {
      toast({
        variant: "destructive",
        title: "Invalid profile values",
        description: validationError,
      });
      return;
    }

    const updatedAttributes: Partial<Record<ProfileAttributeKey, string>> = {};
    const deletedAttributes: ProfileAttributeKey[] = [];

    for (const { key } of PROFILE_FIELDS) {
      const currentValue = normalizedValues[key];
      const initialValue = normalizedInitialValues[key];

      if (currentValue === initialValue) {
        continue;
      }

      if (currentValue) {
        updatedAttributes[key] = currentValue;
      } else if (initialValue) {
        deletedAttributes.push(key);
      }
    }

    if (deletedAttributes.length === 0 && Object.keys(updatedAttributes).length === 0) {
      toast({
        title: "No changes to save",
        description: "Update one or more fields before saving.",
      });
      return;
    }

    setIdentitySaving(true);

    try {
      if (deletedAttributes.length > 0) {
        await deleteUserAttributes({
          userAttributeKeys: deletedAttributes as [
            ProfileAttributeKey,
            ...ProfileAttributeKey[],
          ],
        });
      }

      const pendingVerificationMessages: string[] = [];

      if (Object.keys(updatedAttributes).length > 0) {
        const result = await updateUserAttributes({
          userAttributes: updatedAttributes,
        });

        for (const [attributeKey, status] of Object.entries(result)) {
          if (status.nextStep.updateAttributeStep !== "CONFIRM_ATTRIBUTE_WITH_CODE") {
            continue;
          }

          const deliveryDetails = status.nextStep.codeDeliveryDetails;
          const medium = deliveryDetails?.deliveryMedium?.toLowerCase();
          const destination = deliveryDetails?.destination;

          pendingVerificationMessages.push(
            [
              `Confirm ${formatAttributeLabel(attributeKey)}`,
              medium ? `via ${medium}` : null,
              destination ? `sent to ${destination}` : null,
            ]
              .filter(Boolean)
              .join(" ")
          );
        }
      }

      setProfileValues(normalizedValues);
      setInitialProfileValues(normalizedValues);

      toast({
        title: "Profile updated",
        description:
          pendingVerificationMessages.length > 0
            ? pendingVerificationMessages.join(". ")
            : "Your Cognito profile attributes were saved.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Profile update failed",
        description:
          error instanceof Error
            ? error.message
            : "Cognito rejected the profile update.",
      });
    } finally {
      setIdentitySaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1128px] px-4 py-6 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Settings
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Select value={theme} onValueChange={(v) => setTheme(v as "system" | "light" | "dark")}>
              <SelectTrigger className="h-[34px] w-[34px] p-[3px] [&>svg:last-child]:hidden">
                <SelectValue>
                  {theme === "light" && <Sun className="h-7 w-7" />}
                  {theme === "dark" && <Moon className="h-7 w-7" />}
                  {theme === "system" && <Monitor className="h-7 w-7" />}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="system"><span className="flex items-center gap-2"><Monitor className="h-7 w-7" /></span></SelectItem>
                <SelectItem value="light"><span className="flex items-center gap-2"><Sun className="h-7 w-7" /></span></SelectItem>
                <SelectItem value="dark"><span className="flex items-center gap-2"><Moon className="h-7 w-7" /></span></SelectItem>
              </SelectContent>
            </Select>
            {syncing && <span className="text-xs text-muted-foreground italic">Saving…</span>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <span className="text-xs text-muted-foreground">Organization</span>
              <p className="font-medium truncate">{profileValues["custom:organization"] || "—"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Email</span>
              <p className="font-medium truncate">{email || "—"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Groups</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {roles.length > 0 ? roles.map((role) => (
                  <span
                    key={role}
                    className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary"
                  >
                    <Shield className="h-3 w-3" />
                    {role}
                  </span>
                )) : (
                  <span className="text-xs text-muted-foreground italic">No groups assigned</span>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleIdentitySave} className="mt-4 border-t pt-4">
            {identityLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading Cognito profile attributes…
              </p>
            ) : (
              <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
                {PROFILE_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className={field.fullWidth ? "space-y-1 md:col-span-2" : "space-y-1"}
                  >
                    <Label htmlFor={field.key} className="text-xs font-medium">{field.label}</Label>
                    <Input
                      id={field.key}
                      type={field.type ?? "text"}
                      autoComplete={field.autoComplete}
                      placeholder={field.placeholder}
                      value={profileValues[field.key]}
                      onChange={(event) =>
                        updateProfileValue(field.key, event.target.value)
                      }
                      disabled={identitySaving}
                      size={field.size}
                      className={fieldErrors[field.key] ? "border-destructive focus-visible:ring-destructive" : ""}
                    />
                    {fieldErrors[field.key] && (
                      <p className="text-xs text-destructive">{fieldErrors[field.key]}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-3 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleIdentityReset}
                disabled={identityLoading || identitySaving || !isIdentityDirty}
              >
                Reset
              </Button>
              <Button
                type="submit"
                disabled={identityLoading || identitySaving || !isIdentityDirty}
              >
                {identitySaving ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
