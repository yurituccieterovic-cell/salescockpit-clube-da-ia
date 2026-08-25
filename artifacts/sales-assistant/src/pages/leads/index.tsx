import { useState } from "react";
import { Link } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import {
  useListLeads,
  useUpdateLead,
  useDraftEmail,
  getListLeadsQueryKey,
  getListEmailsQueryKey,
  getGetLeadStatusBreakdownQueryKey,
  getGetDashboardStatsQueryKey,
  getGetRecentActivityQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Building2, Mail, Activity, Sparkles, X, CheckCircle2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  contacted: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  qualified: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  unqualified: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  closed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

type ProgressItem = {
  leadId: number;
  leadName: string;
  status: "pending" | "drafting" | "done" | "error";
};

export default function LeadsList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<ProgressItem[] | null>(null);
  const [bulkDone, setBulkDone] = useState(false);

  const queryClient = useQueryClient();
  const { data: leads, isLoading } = useListLeads({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const updateLead = useUpdateLead();
  const draftEmail = useDraftEmail();

  const handleStatusChange = (id: number, newStatus: string) => {
    updateLead.mutate(
      { id, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        },
      }
    );
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!leads) return;
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  };

  const handleBulkDraft = async () => {
    if (!leads) return;
    const targets = leads.filter((l) => selected.has(l.id));
    if (targets.length === 0) return;

    const items: ProgressItem[] = targets.map((l) => ({
      leadId: l.id,
      leadName: l.name,
      status: "pending",
    }));
    setProgress(items);
    setBulkDone(false);

    for (let i = 0; i < items.length; i++) {
      setProgress((prev) =>
        prev
          ? prev.map((p, idx) => (idx === i ? { ...p, status: "drafting" } : p))
          : prev
      );

      await new Promise<void>((resolve) => {
        draftEmail.mutate(
          { data: { leadId: items[i].leadId } },
          {
            onSuccess: () => {
              setProgress((prev) =>
                prev
                  ? prev.map((p, idx) => (idx === i ? { ...p, status: "done" } : p))
                  : prev
              );
              resolve();
            },
            onError: () => {
              setProgress((prev) =>
                prev
                  ? prev.map((p, idx) => (idx === i ? { ...p, status: "error" } : p))
                  : prev
              );
              resolve();
            },
          }
        );
      });
    }

    setBulkDone(true);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLeadStatusBreakdownQueryKey() });
  };

  const closeBulkPanel = () => {
    setProgress(null);
    setBulkDone(false);
  };

  const allSelected = leads ? selected.size === leads.length && leads.length > 0 : false;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
            <p className="text-muted-foreground mt-1">Manage and track your outreach targets.</p>
          </div>
          <Button asChild>
            <Link href="/leads/new" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Lead
            </Link>
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-lg border">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, company, or email..."
              className="pl-8 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="unqualified">Unqualified</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {selected.size > 0 && !progress && (
          <div className="flex items-center justify-between bg-primary/10 border border-primary/30 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-primary">
              {selected.size} lead{selected.size > 1 ? "s" : ""} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setSelected(new Set())}
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
              <Button size="sm" onClick={handleBulkDraft} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Draft Emails for {selected.size} Lead{selected.size > 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {progress && (
          <div className="bg-card border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">
                  {bulkDone ? "All emails drafted" : "Drafting emails with AI..."}
                </h3>
              </div>
              {bulkDone && (
                <Button variant="ghost" size="sm" onClick={closeBulkPanel}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {progress.map((item) => (
                <div
                  key={item.leadId}
                  className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50"
                >
                  <span className="text-sm font-medium">{item.leadName}</span>
                  <span className="flex items-center gap-2 text-xs">
                    {item.status === "pending" && (
                      <span className="text-muted-foreground">Waiting...</span>
                    )}
                    {item.status === "drafting" && (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span className="text-primary">Generating...</span>
                      </>
                    )}
                    {item.status === "done" && (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        <span className="text-green-600">Draft ready</span>
                      </>
                    )}
                    {item.status === "error" && (
                      <span className="text-destructive">Failed</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {bulkDone && (
              <div className="flex items-center gap-2 pt-1">
                <Button asChild size="sm" variant="outline">
                  <Link href="/emails">View all drafts</Link>
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    data-state={someSelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all leads"
                  />
                </TableHead>
                <TableHead>Contact Info</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-[200px]" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-[150px]" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-[100px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-[80px] ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : leads && leads.length > 0 ? (
                leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className={`group transition-colors ${selected.has(lead.id) ? "bg-primary/5" : "hover:bg-muted/50"}`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(lead.id)}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${lead.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {lead.name}
                        </Link>
                        <div className="flex items-center text-xs text-muted-foreground mt-1">
                          <Mail className="mr-1 h-3 w-3" />
                          {lead.email}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          {lead.company}
                        </span>
                        {lead.jobTitle && (
                          <span className="text-xs text-muted-foreground mt-0.5">{lead.jobTitle}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={lead.status}
                        onValueChange={(val) => handleStatusChange(lead.id, val)}
                      >
                        <SelectTrigger
                          className={`h-8 w-[130px] border-none text-xs font-medium focus:ring-0 ${statusColors[lead.status] || "bg-secondary text-secondary-foreground"}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">New</SelectItem>
                          <SelectItem value="contacted">Contacted</SelectItem>
                          <SelectItem value="qualified">Qualified</SelectItem>
                          <SelectItem value="unqualified">Unqualified</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(lead.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Link href={`/leads/${lead.id}`}>View Details</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Activity className="h-10 w-10 mb-2 opacity-20" />
                      <p>No leads found.</p>
                      {search || statusFilter !== "all" ? (
                        <p className="text-sm mt-1">Try adjusting your filters.</p>
                      ) : (
                        <Button variant="link" asChild className="mt-2 text-primary">
                          <Link href="/leads/new">Add your first lead</Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </MainLayout>
  );
}
