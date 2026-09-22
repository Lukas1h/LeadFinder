"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { markListingsPassed } from "./actions";
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
} from "@/components/ui/alert-dialog";

export function MarkAllNotInterestedButton({ listingIds }: { listingIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (listingIds.length === 0) return null;

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        await markListingsPassed(listingIds);
        toast.success(
          `Marked ${listingIds.length} listing${listingIds.length === 1 ? "" : "s"} as not interested`
        );
      } catch {
        toast.error("Something went wrong marking listings as not interested");
      } finally {
        setOpen(false);
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground normal-case font-medium tracking-normal"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <X />
        Not interested
      </Button>
      <AlertDialogContent
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            Mark {listingIds.length} listing{listingIds.length === 1 ? "" : "s"} as not interested?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will move {listingIds.length === 1 ? "this listing" : "these listings"} to declined and
            out of your new leads.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={isPending}
          >
            {isPending ? "Marking…" : "Yes, mark not interested"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
