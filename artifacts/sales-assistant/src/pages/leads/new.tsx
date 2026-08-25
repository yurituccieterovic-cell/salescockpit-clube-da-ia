import { useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useCreateLead, getListLeadsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

export default function NewLead() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createLead = useCreateLead();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    jobTitle: "",
    industry: "",
    website: "",
    notes: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.company) {
      toast({
        title: "Required fields missing",
        description: "Please fill in the name, email, and company.",
        variant: "destructive",
      });
      return;
    }

    createLead.mutate(
      { data: formData },
      {
        onSuccess: (newLead) => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          toast({
            title: "Lead created",
            description: `${newLead.name} has been added to your leads.`,
          });
          setLocation(`/leads/${newLead.id}`);
        },
        onError: () => {
          toast({
            title: "Error creating lead",
            description: "Something went wrong. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <MainLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2 text-muted-foreground hover:text-foreground">
            <Link href="/leads">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Leads
            </Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Add New Lead</h1>
          <p className="text-muted-foreground mt-1">Enter the prospect's details to start tracking them.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
              <CardDescription>The essentials for outreach.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Jane Doe"
                    value={formData.name}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address *</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="jane@example.com"
                    value={formData.email}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">Company *</Label>
                  <Input
                    id="company"
                    name="company"
                    placeholder="Acme Corp"
                    value={formData.company}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Job Title</Label>
                  <Input
                    id="jobTitle"
                    name="jobTitle"
                    placeholder="VP of Sales"
                    value={formData.jobTitle}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="industry">Industry</Label>
                  <Input
                    id="industry"
                    name="industry"
                    placeholder="Software"
                    value={formData.industry}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    name="website"
                    placeholder="https://acme.com"
                    value={formData.website}
                    onChange={handleChange}
                  />
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Context about this lead, interesting angles, etc."
                  value={formData.notes}
                  onChange={handleChange}
                  className="min-h-[100px]"
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t px-6 py-4 bg-muted/20">
              <Button type="button" variant="outline" asChild>
                <Link href="/leads">Cancel</Link>
              </Button>
              <Button type="submit" disabled={createLead.isPending}>
                {createLead.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Create Lead"
                )}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </MainLayout>
  );
}
