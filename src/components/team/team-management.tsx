"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canManageTeam, canChangeRoles, canApproveDeletions } from "@/lib/permissions";
import type { UserRole, DeleteRequest } from "@/lib/types";

interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  conversations: number;
  documents: number;
}

interface PendingDeleteRequest extends DeleteRequest {
  documents: { id: string; title: string; category: string } | null;
  requester: { full_name: string; email: string } | null;
}

interface TeamManagementProps {
  currentUserId: string;
  currentUserRole: UserRole;
  initialMembers: TeamMember[];
  initialDeleteRequests: PendingDeleteRequest[];
}

const ROLES: { label: string; value: UserRole }[] = [
  { label: "Admin", value: "admin" },
  { label: "Manager", value: "manager" },
  { label: "Agent", value: "agent" },
];

export function TeamManagement({
  currentUserId,
  currentUserRole,
  initialMembers,
  initialDeleteRequests,
}: TeamManagementProps) {
  const [members, setMembers] = useState(initialMembers);
  const [deleteRequests, setDeleteRequests] = useState(initialDeleteRequests);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("agent");
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  const isAdmin = canManageTeam(currentUserRole);
  const canApprove = canApproveDeletions(currentUserRole);

  const handleAddMember = useCallback(async () => {
    if (!newEmail.trim() || !newName.trim()) return;
    setAdding(true);

    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          full_name: newName.trim(),
          role: newRole,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to add member");
        setAdding(false);
        return;
      }

      toast.success(`Added ${newName.trim()}`);
      setShowAddDialog(false);
      setNewEmail("");
      setNewName("");
      setNewRole("agent");
      router.refresh();
    } catch {
      toast.error("Failed to add member");
    }

    setAdding(false);
  }, [newEmail, newName, newRole, router]);

  const handleRoleChange = useCallback(
    async (memberId: string, role: UserRole) => {
      try {
        const res = await fetch("/api/team", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: memberId, role }),
        });

        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || "Failed to update role");
          return;
        }

        setMembers((prev) =>
          prev.map((m) => (m.id === memberId ? { ...m, role } : m))
        );
        toast.success("Role updated");
      } catch {
        toast.error("Failed to update role");
      }
    },
    []
  );

  const handleToggleActive = useCallback(
    async (memberId: string, is_active: boolean) => {
      try {
        const res = await fetch("/api/team", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: memberId, is_active }),
        });

        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || "Failed to update");
          return;
        }

        setMembers((prev) =>
          prev.map((m) => (m.id === memberId ? { ...m, is_active } : m))
        );
      } catch {
        toast.error("Failed to update");
      }
    },
    []
  );

  const handleDeleteAction = useCallback(
    async (requestId: string, action: "approve" | "reject") => {
      try {
        const res = await fetch("/api/delete-requests", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: requestId, action }),
        });

        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || `Failed to ${action}`);
          return;
        }

        setDeleteRequests((prev) => prev.filter((r) => r.id !== requestId));
        toast.success(action === "approve" ? "Document deleted" : "Request rejected");
        if (action === "approve") router.refresh();
      } catch {
        toast.error(`Failed to ${action}`);
      }
    },
    [router]
  );

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-b from-[#f5f5f7] to-white/70 bg-clip-text text-transparent">
            Team
          </h1>
          <p className="text-gray-8 text-sm mt-2">
            {members.length} member{members.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddDialog(true)}
            className="text-xs text-white font-bold px-4 lg:px-5 py-2 rounded-full bg-gradient-to-br from-ruby-9 to-ruby-10 shadow-[0_0_20px_rgba(196,18,48,0.2)] hover:shadow-[0_0_30px_rgba(196,18,48,0.35)] hover:-translate-y-px active:translate-y-px active:scale-[0.96] transition-all"
          >
            Add Member
          </button>
        )}
      </div>

      {/* Pending Delete Requests */}
      {canApprove && deleteRequests.length > 0 && (
        <div className="mb-10">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-400 mb-4">
            Pending Delete Requests ({deleteRequests.length})
          </h2>
          <div className="space-y-2">
            {deleteRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center gap-4 px-5 py-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.03]"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-semibold text-[#f5f5f7]">
                    {req.documents?.title || "Unknown document"}
                  </span>
                  <span className="text-[12px] text-gray-8 ml-2">
                    requested by {req.requester?.full_name || "Unknown"}
                  </span>
                  {req.reason && (
                    <p className="text-[12px] text-gray-7 mt-0.5">
                      Reason: {req.reason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleDeleteAction(req.id, "approve")}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-ruby-9/10 text-ruby-11 border border-ruby-9/20 hover:bg-ruby-9/20 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleDeleteAction(req.id, "reject")}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/[0.04] text-gray-9 border border-white/[0.06] hover:bg-white/[0.08] transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Members */}
      <div className="space-y-3">
        {members.map((member) => {
          const initials = member.full_name
            .split(/[\s@]/)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase() || "")
            .join("");

          const isMe = member.id === currentUserId;

          return (
            <div
              key={member.id}
              className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-white/[0.04] bg-white/[0.015]"
            >
              <div className="w-10 h-10 rounded-full bg-ruby-3 border border-ruby-6 flex items-center justify-center text-sm font-bold text-ruby-11 flex-shrink-0">
                {initials || "?"}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[#f5f5f7] truncate">
                    {member.full_name}
                  </span>
                  {isMe && (
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-gray-9">
                      You
                    </span>
                  )}

                  {/* Role: editable for admin, static for others */}
                  {isAdmin && canChangeRoles(currentUserRole) && !isMe ? (
                    <Select
                      value={member.role}
                      onValueChange={(v) =>
                        handleRoleChange(member.id, v as UserRole)
                      }
                    >
                      <SelectTrigger className="h-6 w-auto px-2 py-0 text-[10px] font-bold uppercase tracking-[0.08em] bg-transparent border-0 hover:bg-white/[0.04]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-2 border-white/[0.06]">
                        {ROLES.map((r) => (
                          <SelectItem
                            key={r.value}
                            value={r.value}
                            className="text-xs"
                          >
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span
                      className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full ${
                        member.role === "admin"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : member.role === "manager"
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : "bg-white/[0.04] text-gray-8"
                      }`}
                    >
                      {member.role}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-gray-8 mt-0.5">
                  {member.email}
                </div>
              </div>

              <div className="hidden lg:flex items-center gap-6 text-center flex-shrink-0">
                <div>
                  <div className="text-[16px] font-bold text-[#f5f5f7]">
                    {member.conversations}
                  </div>
                  <div className="text-[10px] text-gray-7 uppercase tracking-wider">
                    Chats
                  </div>
                </div>
                <div>
                  <div className="text-[16px] font-bold text-[#f5f5f7]">
                    {member.documents}
                  </div>
                  <div className="text-[10px] text-gray-7 uppercase tracking-wider">
                    Docs
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {isAdmin && !isMe ? (
                  <button
                    onClick={() =>
                      handleToggleActive(member.id, !member.is_active)
                    }
                    className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                      member.is_active
                        ? "text-[#30d158] hover:text-gray-8"
                        : "text-gray-7 hover:text-[#30d158]"
                    }`}
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${member.is_active ? "bg-[#30d158]" : "bg-gray-7"}`}
                    />
                    {member.is_active ? "Active" : "Inactive"}
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${member.is_active ? "bg-[#30d158]" : "bg-gray-7"}`}
                    />
                    <span className="text-[11px] text-gray-8">
                      {member.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Member Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          if (!open && !adding) {
            setShowAddDialog(false);
            setNewEmail("");
            setNewName("");
            setNewRole("agent");
          }
        }}
      >
        <DialogContent className="bg-gray-2 border-white/[0.06] text-gray-12 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Add Team Member
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-11">Email</Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="name@company.com"
                className="h-9 bg-white/5 border-white/8 text-gray-12 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-11">Full Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="John Smith"
                className="h-9 bg-white/5 border-white/8 text-gray-12 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-11">Role</Label>
              <Select
                value={newRole}
                onValueChange={(v) => setNewRole(v as UserRole)}
              >
                <SelectTrigger className="h-9 bg-white/5 border-white/8 text-gray-12 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-2 border-white/[0.06]">
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => setShowAddDialog(false)}
                disabled={adding}
                className="text-gray-9 hover:text-gray-12"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddMember}
                disabled={adding || !newEmail.trim() || !newName.trim()}
                className="bg-gradient-to-br from-ruby-9 to-ruby-10 text-white font-bold hover:shadow-[0_0_20px_rgba(196,18,48,0.3)]"
              >
                {adding ? "Adding..." : "Add Member"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
