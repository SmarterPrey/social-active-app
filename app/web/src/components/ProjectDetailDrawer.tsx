import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Save, Trash2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Account, ProjectData } from "@/types/types";
import {
  queryProjectAccounts,
  mutateAddProjectAccount,
  mutateDeleteProjectAccount,
} from "@/lib/utils";

interface ProjectDetailDrawerProps {
  project: ProjectData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CLOUD_OPTIONS = ["AWS", "Azure", "ROSA"] as const;
const ENV_OPTIONS = ["Dev", "QA", "Stage", "Prod"] as const;

export function ProjectDetailDrawer({
  project,
  open,
  onOpenChange,
}: ProjectDetailDrawerProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dnsOpen, setDnsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<ProjectData | null>(null);

  // Accounts state
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    Account_Name: "",
    Account_Id: "",
    Cloud: "",
    Environments: [] as string[],
  });
  const [savingAccount, setSavingAccount] = useState(false);

  // Load accounts when drawer opens with a project
  useEffect(() => {
    if (open && project) {
      loadAccounts(project.projectName);
    }
  }, [open, project]);

  const loadAccounts = async (projectName: string) => {
    setLoadingAccounts(true);
    try {
      const res = await queryProjectAccounts(projectName);
      setAccounts(
        (res.data.getProjectAccounts ?? []).filter(
          (a): a is Account => a != null
        )
      );
    } catch (err) {
      console.error("Failed to load accounts:", err);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // Reset state when drawer opens with new project
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setDetailsOpen(false);
      setDnsOpen(false);
      setAuthOpen(false);
      setIsEditing(false);
      setEditData(null);
      setShowAddAccount(false);
      setNewAccount({ Account_Name: "", Account_Id: "", Cloud: "", Environments: [] });
      setAccounts([]);
    }
    onOpenChange(open);
  };

  const startEditing = () => {
    setEditData(project ? { ...project } : null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditData(null);
    setIsEditing(false);
    setDetailsOpen(false);
  };

  const saveEdits = () => {
    // TODO: wire to GraphQL mutation to persist changes
    console.log("Saving project edits:", editData);
    setIsEditing(false);
    setEditData(null);
  };

  const handleFieldChange = (field: keyof ProjectData, value: string) => {
    if (editData) {
      setEditData({ ...editData, [field]: value });
    }
  };

  const handleAddAccount = async () => {
    if (
      !project ||
      !newAccount.Account_Name ||
      !newAccount.Account_Id ||
      !newAccount.Cloud ||
      newAccount.Environments.length === 0
    )
      return;
    setSavingAccount(true);
    try {
      const res = await mutateAddProjectAccount({
        projectName: project.projectName,
        Account_Name: newAccount.Account_Name,
        Account_Id: newAccount.Account_Id,
        Cloud: newAccount.Cloud,
        Environments: newAccount.Environments.join(", "),
      });
      const added = res.data.addProjectAccount;
      if (added) {
        setAccounts((prev) => [...prev, added]);
      }
      setNewAccount({ Account_Name: "", Account_Id: "", Cloud: "", Environments: [] });
      setShowAddAccount(false);
    } catch (err) {
      console.error("Failed to add account:", err);
    } finally {
      setSavingAccount(false);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      await mutateDeleteProjectAccount(accountId);
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (err) {
      console.error("Failed to delete account:", err);
    }
  };

  const toggleEnv = (env: string) => {
    setNewAccount((prev) => ({
      ...prev,
      Environments: prev.Environments.includes(env)
        ? prev.Environments.filter((e) => e !== env)
        : [...prev.Environments, env],
    }));
  };

  if (!project) return null;

  const displayData = isEditing && editData ? editData : project;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader className="pr-8">
          <SheetTitle className="text-xl">{project.projectName}</SheetTitle>
          <SheetDescription>Business service details and configuration</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* ──────────── Section 1: Project Information ──────────── */}
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between rounded-lg border p-4 font-semibold hover:bg-muted/50 transition-colors">
                <span>Project Information</span>
                {detailsOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="rounded-b-lg border border-t-0 p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Department Number
                    </Label>
                    {isEditing ? (
                      <Input
                        value={displayData.DepartmentNumber ?? ""}
                        onChange={(e) =>
                          handleFieldChange("DepartmentNumber", e.target.value)
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {displayData.DepartmentNumber || "—"}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Data Classification
                    </Label>
                    {isEditing ? (
                      <Input
                        value={displayData.DataClassification ?? ""}
                        onChange={(e) =>
                          handleFieldChange("DataClassification", e.target.value)
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {displayData.DataClassification || "—"}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Team</Label>
                    {isEditing ? (
                      <Input
                        value={displayData.Team ?? ""}
                        onChange={(e) =>
                          handleFieldChange("Team", e.target.value)
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {displayData.Team || "—"}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Owner Group
                    </Label>
                    {isEditing ? (
                      <Input
                        value={displayData.OwnerGroup ?? ""}
                        onChange={(e) =>
                          handleFieldChange("OwnerGroup", e.target.value)
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {displayData.OwnerGroup || "—"}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Recovery
                    </Label>
                    {isEditing ? (
                      <Input
                        value={displayData.Recovery ?? ""}
                        onChange={(e) =>
                          handleFieldChange("Recovery", e.target.value)
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {displayData.Recovery || "—"}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Tier</Label>
                    {isEditing ? (
                      <Input
                        value={displayData.Tier ?? ""}
                        onChange={(e) =>
                          handleFieldChange("Tier", e.target.value)
                        }
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {displayData.Tier || "—"}
                      </p>
                    )}
                  </div>
                </div>

                {/* Edit / Save / Cancel buttons */}
                <div className="flex gap-2 pt-2">
                  {isEditing ? (
                    <>
                      <Button size="sm" onClick={saveEdits}>
                        <Save className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelEditing}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={startEditing}>
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ──────────── Section 2: Configuration ──────────── */}
          <div className="space-y-2">
            {/* DNS Configuration */}
            <Collapsible open={dnsOpen} onOpenChange={setDnsOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between rounded-lg border p-4 font-semibold hover:bg-muted/50 transition-colors">
                  <span>DNS Configuration</span>
                  {dnsOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="rounded-b-lg border border-t-0 p-4">
                  <p className="text-sm text-muted-foreground italic">
                    No DNS configuration yet.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Auth0 M2M and SSO Configuration */}
            <Collapsible open={authOpen} onOpenChange={setAuthOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between rounded-lg border p-4 font-semibold hover:bg-muted/50 transition-colors">
                  <span>Auth0 M2M and SSO Configuration</span>
                  {authOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="rounded-b-lg border border-t-0 p-4">
                  <p className="text-sm text-muted-foreground italic">
                    No Auth0 configuration yet.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <Separator />

          {/* ──────────── Section 3: Resources & Applications Tabs ──────────── */}
          <div className="rounded-lg border p-4">
            <Tabs defaultValue="accounts">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="accounts">Resources</TabsTrigger>
                <TabsTrigger value="applications">Resource Pipelines</TabsTrigger>
              </TabsList>

              <TabsContent value="accounts" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resource Name</TableHead>
                      <TableHead>Resource Identifier</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Approved For</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingAccounts ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground py-8"
                        >
                          Loading resources...
                        </TableCell>
                      </TableRow>
                    ) : accounts.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground italic py-8"
                        >
                          No resources configured
                        </TableCell>
                      </TableRow>
                    ) : (
                      accounts.filter(Boolean).map((acct) => (
                        <TableRow key={acct.id}>
                          <TableCell>{acct.Account_Name}</TableCell>
                          <TableCell>{acct.Account_Id}</TableCell>
                          <TableCell>{acct.Cloud}</TableCell>
                          <TableCell>{acct.Environments}</TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteAccount(acct.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                {showAddAccount && (
                  <div className="mt-4 rounded-lg border p-4 space-y-3 bg-muted/30">
                    <p className="font-semibold text-sm">New Resource</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Resource Name</Label>
                        <Input
                          placeholder="e.g. my-project-dev"
                          value={newAccount.Account_Name}
                          onChange={(e) =>
                            setNewAccount((p) => ({
                              ...p,
                              Account_Name: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Resource Identifier</Label>
                        <Input
                          placeholder="e.g. 123456789012"
                          value={newAccount.Account_Id}
                          onChange={(e) =>
                            setNewAccount((p) => ({
                              ...p,
                              Account_Id: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={newAccount.Cloud}
                          onValueChange={(val) =>
                            setNewAccount((p) => ({ ...p, Cloud: val }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select cloud" />
                          </SelectTrigger>
                          <SelectContent>
                            {CLOUD_OPTIONS.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Approved For</Label>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {ENV_OPTIONS.map((env) => {
                            const selected =
                              newAccount.Environments.includes(env);
                            return (
                              <button
                                key={env}
                                type="button"
                                onClick={() => toggleEnv(env)}
                                className={
                                  "rounded-md border px-3 py-1 text-xs font-medium transition-colors " +
                                  (selected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-input bg-background hover:bg-muted")
                                }
                              >
                                {env}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={handleAddAccount}
                        disabled={savingAccount}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        {savingAccount ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowAddAccount(false);
                          setNewAccount({
                            Account_Name: "",
                            Account_Id: "",
                            Cloud: "",
                            Environments: [],
                          });
                        }}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddAccount(true)}
                    disabled={showAddAccount}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Resource
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="applications" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Authorizations</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell
                        colSpan={1}
                        className="text-center text-muted-foreground italic py-8"
                      >
                        No resource pipelines configured
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div className="mt-4 flex justify-end">
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Resource Pipeline
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
