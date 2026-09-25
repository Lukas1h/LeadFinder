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

export function PassAllListingsButton({ listingIds }: { listingIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (listingIds.length === 0) return null;

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        await markListingsPassed(listingIds);
        toast.success(`Passed on ${listingIds.length} listing${listingIds.length === 1 ? "" : "s"}`);
      } catch {
        toast.error("Something went wrong passing on those listings");
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
        Pass all
      </Button>
      <AlertDialogContent
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            Pass on {listingIds.length} listing{listingIds.length === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This moves {listingIds.length === 1 ? "this listing" : "these listings"} to passed and out of
            your new leads. Passing is about the property, not the agent &mdash; it won&rsquo;t mark
            anyone as declining you.
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
            {isPending ? "Passing…" : "Yes, pass on these"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
