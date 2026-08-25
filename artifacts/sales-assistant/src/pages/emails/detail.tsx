import { useState, useEffect, useRef } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { 
  useGetEmail, 
  useUpdateEmail, 
  useDeleteEmail,
  useSendEmail,
  getGetEmailQueryKey,
  getListEmailsQueryKey,
  getListLeadEmailsQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Trash2, Save, User, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

export default function EmailDetail() {
  const [, params] = useRoute("/emails/:id");
  const emailId = Number(params?.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const { data: email, isLoading: isEmailLoading } = useGetEmail(emailId, {
    query: { enabled: !!emailId }
  });

  const initializedForId = useRef<number | null>(null);
  const updateEmail = useUpdateEmail();
  const deleteEmail = useDeleteEmail();
  const sendEmail = useSendEmail();

  useEffect(() => {
    if (email && initializedForId.current !== emailId) {
      initializedForId.current = emailId;
      setSubject(email.subject);
      setBody(email.body);
    }
  }, [email, emailId]);

  const handleSave = () => {
    updateEmail.mutate(
      { id: emailId, data: { subject, body } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmailQueryKey(emailId) });
          queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey() });
          if (email?.leadId) {
            queryClient.invalidateQueries({ queryKey: getListLeadEmailsQueryKey(email.leadId) });
          }
          toast({ title: "Draft saved" });
        }
      }
    );
  };

  const handleSend = () => {
    sendEmail.mutate(
      { id: emailId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmailQueryKey(emailId) });
          queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey() });
          if (email?.leadId) {
            queryClient.invalidateQueries({ queryKey: getListLeadEmailsQueryKey(email.leadId) });
          }
          toast({ title: "Email sent successfully" });
        },
        onError: () => {
          toast({ title: "Failed to send email", variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = () => {
    deleteEmail.mutate(
      { id: emailId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey() });
          if (email?.leadId) {
            queryClient.invalidateQueries({ queryKey: getListLeadEmailsQueryKey(email.leadId) });
          }
          toast({ title: "Email deleted" });
          setLocation("/emails");
        }
      }
    );
  };

  if (!emailId) return <MainLayout><div>Invalid email ID</div></MainLayout>;

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2 text-muted-foreground hover:text-foreground">
              <Link href={email?.leadId ? `/leads/${email.leadId}` : "/emails"}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            <h1 className="text-3xl font-bold tracking-tight">
              {email?.status === 'sent' ? 'View Email' : 'Edit Draft'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {email?.status === 'draft' && (
              <>
                <Button variant="outline" onClick={handleSave} disabled={updateEmail.isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  {updateEmail.isPending ? "Saving..." : "Save Draft"}
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleteEmail.isPending}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button onClick={handleSend} disabled={sendEmail.isPending}>
                  <Send className="mr-2 h-4 w-4" />
                  {sendEmail.isPending ? "Sending..." : "Send Email"}
                </Button>
              </>
            )}
          </div>
        </div>

        <Card className="border-t-4 border-t-primary shadow-sm">
          <CardHeader className="bg-muted/30 border-b pb-4">
            <div className="space-y-4">
              {isEmailLoading ? (
                <>
                  <Skeleton className="h-6 w-1/3" />
                  <Skeleton className="h-6 w-1/2" />
                </>
              ) : email ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-muted-foreground w-16">To:</span>
                      <Link href={`/leads/${email.leadId}`} className="flex items-center gap-1.5 font-medium hover:text-primary transition-colors bg-background px-2.5 py-1 rounded-md border">
                        <User className="h-3.5 w-3.5" />
                        Lead #{email.leadId}
                      </Link>
                    </div>
                    {email.status === 'sent' && email.sentAt && (
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Clock className="mr-1.5 h-3.5 w-3.5" />
                        Sent on {format(new Date(email.sentAt), "MMM d, yyyy 'at' h:mm a")}
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="subject" className="text-muted-foreground w-16 inline-block">Subject:</Label>
                    {email.status === 'draft' ? (
                      <Input 
                        id="subject" 
                        value={subject} 
                        onChange={(e) => setSubject(e.target.value)}
                        className="font-medium text-base bg-background"
                      />
                    ) : (
                      <span className="font-medium text-base ml-1">{email.subject}</span>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isEmailLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full mt-8" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : email ? (
              email.status === 'draft' ? (
                <Textarea 
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-[400px] border-0 focus-visible:ring-0 rounded-none p-6 text-base resize-none"
                  placeholder="Write your message..."
                />
              ) : (
                <div className="p-6 min-h-[400px] whitespace-pre-wrap text-base">
                  {email.body}
                </div>
              )
            ) : null}
          </CardContent>
          {email?.status === 'draft' && (
            <CardFooter className="bg-muted/30 border-t py-3 flex justify-between text-sm text-muted-foreground">
              <span>Edit this draft and click Send when ready.</span>
            </CardFooter>
          )}
        </Card>
      </div>
    </MainLayout>
  );
}
