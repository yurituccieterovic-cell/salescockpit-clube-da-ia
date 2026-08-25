import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { 
  useGetLead, 
  useUpdateLead, 
  useDeleteLead, 
  useListLeadEmails,
  useDraftEmail,
  getGetLeadQueryKey,
  getListLeadEmailsQueryKey,
  getListEmailsQueryKey,
  getListLeadsQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Building2, Mail, Globe, Briefcase, Trash2, Edit, Sparkles, Send, FileText, Clock, PenTool } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  contacted: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  qualified: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  unqualified: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  closed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

export default function LeadDetail() {
  const [, params] = useRoute("/leads/:id");
  const leadId = Number(params?.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [draftContext, setDraftContext] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const { data: lead, isLoading: isLeadLoading } = useGetLead(leadId, {
    query: { enabled: !!leadId }
  });
  
  const { data: emails, isLoading: isEmailsLoading } = useListLeadEmails(leadId, {
    query: { enabled: !!leadId }
  });

  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const draftEmail = useDraftEmail();

  const handleStatusChange = (newStatus: string) => {
    updateLead.mutate(
      { id: leadId, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          toast({ title: "Status updated successfully" });
        }
      }
    );
  };

  const handleDelete = () => {
    deleteLead.mutate(
      { id: leadId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          toast({ title: "Lead deleted" });
          setLocation("/leads");
        }
      }
    );
  };

  const handleDraftEmail = () => {
    setIsDrafting(true);
    draftEmail.mutate(
      { data: { leadId, context: draftContext } },
      {
        onSuccess: (newEmail) => {
          queryClient.invalidateQueries({ queryKey: getListLeadEmailsQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey() });
          setDraftContext("");
          setIsDrafting(false);
          toast({ 
            title: "Email drafted successfully",
            description: "You can now review and send it."
          });
          setLocation(`/emails/${newEmail.id}`);
        },
        onError: () => {
          setIsDrafting(false);
          toast({ 
            title: "Failed to draft email", 
            description: "Please try again later.",
            variant: "destructive"
          });
        }
      }
    );
  };

  if (!leadId) return <MainLayout><div>Invalid lead ID</div></MainLayout>;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2 text-muted-foreground hover:text-foreground">
              <Link href="/leads">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Leads
              </Link>
            </Button>
            {isLeadLoading ? (
              <Skeleton className="h-10 w-64 mt-1" />
            ) : (
              <h1 className="text-3xl font-bold tracking-tight">{lead?.name}</h1>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lead && (
              <Select value={lead.status} onValueChange={handleStatusChange}>
                <SelectTrigger className={`w-[140px] border-none font-medium focus:ring-0 ${statusColors[lead.status] || "bg-secondary text-secondary-foreground"}`}>
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
            )}
            
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Lead</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to delete this lead? This action cannot be undone and will remove all associated emails.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={handleDelete} disabled={deleteLead.isPending}>
                    {deleteLead.isPending ? "Deleting..." : "Delete"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLeadLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-3/4" />
                  </div>
                ) : lead ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Email</p>
                        <a href={`mailto:${lead.email}`} className="text-sm font-medium hover:text-primary truncate block">{lead.email}</a>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Company</p>
                        <p className="text-sm font-medium truncate">{lead.company}</p>
                      </div>
                    </div>

                    {lead.jobTitle && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                          <Briefcase className="h-4 w-4" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Role</p>
                          <p className="text-sm font-medium truncate">{lead.jobTitle}</p>
                        </div>
                      </div>
                    )}

                    {lead.website && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                          <Globe className="h-4 w-4" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Website</p>
                          <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" className="text-sm font-medium hover:text-primary truncate block">
                            {lead.website}
                          </a>
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {isLeadLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : lead?.notes ? (
                  <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No notes added for this lead.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <Card className="border-primary/20 bg-primary/5 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Draft AI Outreach
                </CardTitle>
                <CardDescription>
                  Let AI write a personalized email based on the lead's profile.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea 
                  placeholder="Optional: Add context, pain points, or a specific angle for the AI to use..."
                  className="bg-background min-h-[80px]"
                  value={draftContext}
                  onChange={(e) => setDraftContext(e.target.value)}
                  disabled={isDrafting}
                />
                <Button 
                  onClick={handleDraftEmail} 
                  disabled={isDrafting || isLeadLoading}
                  className="w-full sm:w-auto"
                >
                  {isDrafting ? (
                    <>
                      <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                      Generating your email...
                    </>
                  ) : (
                    <>
                      <PenTool className="mr-2 h-4 w-4" />
                      Generate Draft
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold tracking-tight">Email History</h3>
              
              {isEmailsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : emails && emails.length > 0 ? (
                <div className="space-y-3">
                  {emails.map((email) => (
                    <Card key={email.id} className={`overflow-hidden transition-all hover:shadow-md ${email.status === 'draft' ? 'border-primary/20' : ''}`}>
                      <Link href={`/emails/${email.id}`} className="block">
                        <div className="p-4 flex flex-col sm:flex-row gap-4 justify-between sm:items-start">
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center gap-2">
                              {email.status === 'sent' ? (
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                  Sent
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                                  Draft
                                </span>
                              )}
                              <h4 className="font-semibold leading-none truncate pr-4">{email.subject}</h4>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">{email.body}</p>
                          </div>
                          <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between gap-2 text-xs text-muted-foreground flex-shrink-0">
                            <div className="flex items-center">
                              {email.status === 'sent' && email.sentAt ? (
                                <><Clock className="mr-1 h-3 w-3" /> {format(new Date(email.sentAt), "MMM d, h:mm a")}</>
                              ) : (
                                <><FileText className="mr-1 h-3 w-3" /> {format(new Date(email.createdAt), "MMM d, h:mm a")}</>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" className="h-8 -mr-2">
                              {email.status === 'draft' ? 'Edit & Send' : 'View'}
                            </Button>
                          </div>
                        </div>
                      </Link>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="bg-muted/50 border border-dashed rounded-lg p-8 text-center">
                  <Mail className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
                  <p className="text-sm font-medium">No emails yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the drafting tool above to write your first message.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
