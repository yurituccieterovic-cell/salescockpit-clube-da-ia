import { useState } from "react";
import { Link } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useListEmails } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Clock, Send, Activity } from "lucide-react";
import { format } from "date-fns";

export default function EmailsList() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const { data: emails, isLoading } = useListEmails({ 
    status: statusFilter !== "all" ? statusFilter : undefined 
  });

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Emails</h1>
            <p className="text-muted-foreground mt-1">Review drafts and track sent messages.</p>
          </div>
        </div>

        <div className="flex bg-card p-4 rounded-lg border">
          <div className="w-full sm:w-48">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="hidden md:table-cell">Preview</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-[80px] rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[250px]" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-[300px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-[80px] ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : emails && emails.length > 0 ? (
                emails.map((email) => (
                  <TableRow key={email.id} className="group hover:bg-muted/50 transition-colors">
                    <TableCell>
                      {email.status === 'sent' ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-900">
                          <Send className="mr-1 h-3 w-3" /> Sent
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-900">
                          <Clock className="mr-1 h-3 w-3" /> Draft
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/emails/${email.id}`} className="hover:underline hover:text-primary">
                        {email.subject || "(No subject)"}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[300px] truncate">
                      {email.body}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {email.status === 'sent' && email.sentAt 
                        ? format(new Date(email.sentAt), "MMM d, yyyy")
                        : format(new Date(email.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/emails/${email.id}`}>
                          {email.status === 'draft' ? 'Edit & Send' : 'View'}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Mail className="h-10 w-10 mb-2 opacity-20" />
                      <p>No emails found.</p>
                      {statusFilter !== "all" && (
                        <p className="text-sm mt-1">Try adjusting your filters.</p>
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
