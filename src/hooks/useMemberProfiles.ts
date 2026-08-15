import { useQuery } from "@tanstack/react-query";
import { fetchMemberProfiles } from "@/lib/member-profiles";

export function useMemberProfiles(familyId?: string) {
  return useQuery({
    queryKey: ["member-profiles", familyId],
    queryFn: () => fetchMemberProfiles(familyId!),
    enabled: !!familyId,
  });
}
