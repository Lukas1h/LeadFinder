"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import type { EmailAccount } from "@/db/schema";
import {
  deleteEmailAccount,
  makeDefaultEmailAccount,
  testEmailAccount,
} from "./actions";
import { EmailAccountForm } from "./EmailAccountForm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Deliberately hand-rolled: the only thing it ever prints is a few minutes
 * or hours, and the app has no date library to reach for.
 */
function relativeTime(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function testSummary(account: EmailAccount): string {
  if (account.lastTestError) return `Test failed: ${account.lastTestError}`;
  if (account.lastTestedAt) return `Tested ${relativeTime(account.lastTestedAt)}`;
  return `${account.smtpHost}:${account.smtpPort} · never tested`;
}

function EmailAccountRow({ account }: { account: EmailAccount }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleMakeActive = () => {
    startTransition(async () => {
      const result = await makeDefaultEmailAccount(account.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Email will now go out from ${account.email}`);
      router.refresh();
    });
  };

  const handleTest = () => {
    startTransition(async () => {
      toast(`Testing the login for ${account.email}…`);
      const result = await testEmailAccount(account.id);
      if (result.error) {
        toast.error("Connection failed", { description: result.error });
      } else {
        toast.success("Connection works");
      }
      router.refresh();
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteEmailAccount(account.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted ${account.label}`);
      router.refresh();
    });
  };

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-foreground">{account.label}</h3>
          {account.isDefault && <Badge variant="secondary">Active</Badge>}
        </div>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {account.fromName ? `${account.fromName} <${account.email}>` : account.email}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{testSummary(account)}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!account.isDefault && (
          <Button variant="ghost" size="sm" onClick={handleMakeActive} disabled={isPending}>
            Make active
          </Button>
        )}
        {/* A button, not a Switch: the last test result isn't a stored setting
            and a toggle that flips back on its own would read as "connection
            is on". */}
        <Button variant="outline" size="sm" onClick={handleTest} disabled={isPending}>
          {isPending ? "Testing…" : "Test"}
        </Button>
        <EmailAccountForm
          account={account}
          trigger={
            <Button variant="ghost" size="icon">
              <Pencil />
              <span className="sr-only">Edit</span>
            </Button>
          }
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Trash2 />
              <span className="sr-only">Delete</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{account.label}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                The address and its app password are removed from this machine. Mail already sent is
                untouched &mdash; this only decides where future outreach comes from.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function EmailAccountsCard({
  accounts,
  envFallbackEmail,
}: {
  accounts: EmailAccount[];
  envFallbackEmail: string | null;
}) {
  return (
    <Card className="p-4 mb-8 gap-3">
      <div className="flex items-center gap-2">
        <Send className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground text-sm">Sending email</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Outreach goes out from whichever account is marked active. Switching takes effect on the next
        email sent.
      </p>

      {accounts.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border border-dashed p-4">
          <p className="text-sm text-muted-foreground">
            No sending accounts set up yet &mdash; email is still going out from{" "}
            {envFallbackEmail ? (
              <span className="font-mono text-xs">{envFallbackEmail}</span>
            ) : (
              "the account configured in the environment"
            )}
            . Add one here to be able to switch senders without a redeploy.
          </p>
          <EmailAccountForm
            trigger={
              <Button className="self-start">
                <Plus />
                Add account
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((account) => (
            <EmailAccountRow key={account.id} account={account} />
          ))}
          <EmailAccountForm
            trigger={
              <Button variant="outline" className="self-start">
                <Plus />
                Add account
              </Button>
            }
          />
        </div>
      )}

      {envFallbackEmail && accounts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          The ICLOUD_EMAIL / ICLOUD_APP_PASSWORD environment variables are still set and are used as a
          fallback if every account here is deleted.
        </p>
      )}
    </Card>
  );
}