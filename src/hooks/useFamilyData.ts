import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  ACTIVE_FAMILY_KEY,
  fetchFinancialProfile,
  fetchMembers,
  fetchMyFamilies,
  fetchProfile,
} from "@/lib/family";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getActiveFamilyId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_FAMILY_KEY);
}

export function useActiveFamilyId() {
  return useSyncExternalStore(subscribe, getActiveFamilyId, () => null);
}

export function useSetActiveFamily() {
  const queryClient = useQueryClient();
  return (familyId: string) => {
    window.localStorage.setItem(ACTIVE_FAMILY_KEY, familyId);
    listeners.forEach((cb) => cb());
    queryClient.invalidateQueries();
  };
}

export function useFamilies() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["families", user?.id],
    queryFn: fetchMyFamilies,
    enabled: !!user,
  });
}

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => fetchProfile(user!.id),
    enabled: !!user,
  });
}

export function useFamily() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["family", user?.id],
    queryFn: fetchMyFamily,
    enabled: !!user,
  });
}

export function useMembers(familyId?: string) {
  return useQuery({
    queryKey: ["members", familyId],
    queryFn: () => fetchMembers(familyId!),
    enabled: !!familyId,
  });
}

export function useFinancialProfile(familyId?: string) {
  return useQuery({
    queryKey: ["financial-profile", familyId],
    queryFn: () => fetchFinancialProfile(familyId!),
    enabled: !!familyId,
  });
}
