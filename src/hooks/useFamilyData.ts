import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchFinancialProfile,
  fetchMembers,
  fetchMyFamily,
  fetchProfile,
} from "@/lib/family";

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
