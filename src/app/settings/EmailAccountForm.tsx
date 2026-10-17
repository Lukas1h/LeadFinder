"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { EmailAccount } from "@/db/schema";
// Client-safe on purpose: lib/emailAccounts.ts opens the database and imports
// nodemailer, which must not end up in the browser bundle.
import { MAIL_PROVIDERS } from "@/lib/mailProviders";
import type { MailProviderId } from "@/lib/mailProviders";
import { createEmailAccount, updateEmailAccount, type EmailAccountInput } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

const DEFAULT_PROVIDER = MAIL_PROVIDERS[0];

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function EmailAccountForm({
  account,
  trigger,
}: {
  account?: EmailAccount;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Which preset was picked isn't stored, so an edited account always opens on
  // "custom" with the servers it actually has — the preset fields would
  // otherwise overwrite them on the next save.
  const [provider, setProvider] = useState<MailProviderId>(account ? "custom" : DEFAULT_PROVIDER.id);
  const [label, setLabel] = useState(account?.label ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [fromName, setFromName] = useState(account?.fromName ?? "");
  const [password, setPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState(account?.smtpHost ?? DEFAULT_PROVIDER.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(account?.smtpPort ?? DEFAULT_PROVIDER.smtpPort));
  const [smtpSecure, setSmtpSecure] = useState(account?.smtpSecure ?? DEFAULT_PROVIDER.smtpSecure);
  const [imapEnabled, setImapEnabled] = useState(account ? !!account.imapHost : true);
  const [imapHost, setImapHost] = useState(account?.imapHost ?? DEFAULT_PROVIDER.imapHost);
  const [imapPort, setImapPort] = useState(String(account?.imapPort ?? DEFAULT_PROVIDER.imapPort));
  const [imapUser, setImapUser] = useState(account?.imapUser ?? "");
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!account;
  const isCustom = provider === "custom";
  const help = MAIL_PROVIDERS.find((p) => p.id === provider)?.help ?? null;

  const handleProviderChange = (value: string) => {
    const preset = MAIL_PROVIDERS.find((p) => p.id === value);
    setProvider(value as MailProviderId);
    if (!preset) return;
    setSmtpHost(preset.smtpHost);
    setSmtpPort(String(preset.smtpPort));
    setSmtpSecure(preset.smtpSecure);
    setImapHost(preset.imapHost);
    setImapPort(String(preset.imapPort));
    // A preset with no IMAP host has no Sent-folder copy to make.
    setImapEnabled(preset.imapHost !== "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const smtpPortNumber = Number(smtpPort.trim());
    const imapPortNumber = Number(imapPort.trim());

    let validationError: string | null = null;
    if (!label.trim()) validationError = "Give the account a name";
    else if (!email.trim()) validationError = "Enter the address to send from";
    else if (!isEditing && !password.trim()) validationError = "Enter the app password";
    else if (!smtpHost.trim()) validationError = "Enter the SMTP server";
    else if (!isPort(smtpPortNumber)) validationError = "SMTP port must be a number between 1 and 65535";
    else if (imapEnabled && !imapHost.trim()) validationError = "Enter the IMAP server, or turn the Sent copy off";
    else if (imapEnabled && !isPort(imapPortNumber)) validationError = "IMAP port must be a number between 1 and 65535";

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    const input: EmailAccountInput = {
      provider,
      label: label.trim(),
      email: email.trim(),
      fromName: fromName.trim(),
      password: password.trim(),
      smtpHost: smtpHost.trim(),
      smtpPort: smtpPortNumber,
      smtpSecure,
      imapHost: imapEnabled ? imapHost.trim() : "",
      imapPort: imapEnabled ? imapPortNumber : 993,
      imapUser: imapEnabled ? imapUser.trim() : "",
    };

    const result = isEditing ? await updateEmailAccount(account.id, input) : await createEmailAccount(input);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? "Account updated" : "Account added");
    setPassword("");
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit email account" : "Add email account"}</DialogTitle>
            <DialogDescription>
              Outreach is sent from whichever account is marked active. Passwords are encrypted before
              they are stored and are never shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-account-provider">Provider</Label>
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger id="email-account-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAIL_PROVIDERS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isCustom && (
                <p className="text-xs text-muted-foreground font-mono">
                  {smtpHost}:{smtpPort}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-account-label">Label</Label>
              <Input
                id="email-account-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Gmail"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-account-email">Email</Label>
              <Input
                id="email-account-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@gmail.com"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-account-from-name">Sender name</Label>
              <Input
                id="email-account-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="e.g. Lukas Hahn"
              />
              <p className="text-xs text-muted-foreground">
                Shows as the sender instead of the bare address &mdash; recipients see &ldquo;Lukas
                Hahn &lt;your address&gt;&rdquo;. Optional.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-account-password">
                {isEditing ? "New password / app password" : "Password / app password"}
              </Label>
              <Input
                id="email-account-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEditing ? "Leave blank to keep the current password" : "App password"}
                autoComplete="off"
                required={!isEditing}
              />
              {help && <p className="text-xs text-muted-foreground">{help}</p>}
            </div>

            {isCustom && (
              <>
                <div className="grid grid-cols-[1fr_5.5rem] gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-account-smtp-host">SMTP server</Label>
                    <Input
                      id="email-account-smtp-host"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.example.com"
                      required
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-account-smtp-port">SMTP port</Label>
                    <Input
                      id="email-account-smtp-port"
                      type="number"
                      min="1"
                      max="65535"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={smtpSecure}
                    onCheckedChange={(v) => setSmtpSecure(v === true)}
                  />
                  Implicit TLS (port 465) instead of STARTTLS
                </label>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={imapEnabled}
                  onCheckedChange={(v) => setImapEnabled(v === true)}
                />
                Append to Sent folder (IMAP)
              </label>
              <p className="text-xs text-muted-foreground">
                SMTP only transmits &mdash; without this, mail sent from here never appears in the
                provider&rsquo;s own Sent folder.
              </p>

              {imapEnabled && (
                <div className="flex flex-col gap-3 pt-1">
                  <div className="grid grid-cols-[1fr_5.5rem] gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="email-account-imap-host">IMAP server</Label>
                      <Input
                        id="email-account-imap-host"
                        value={imapHost}
                        onChange={(e) => setImapHost(e.target.value)}
                        placeholder="imap.example.com"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="email-account-imap-port">IMAP port</Label>
                      <Input
                        id="email-account-imap-port"
                        type="number"
                        min="1"
                        max="65535"
                        value={imapPort}
                        onChange={(e) => setImapPort(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-account-imap-user">IMAP user</Label>
                    <Input
                      id="email-account-imap-user"
                      value={imapUser}
                      onChange={(e) => setImapUser(e.target.value)}
                      placeholder="Same as the email address"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}