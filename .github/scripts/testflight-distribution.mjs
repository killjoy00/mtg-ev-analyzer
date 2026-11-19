// Apple allows one relationship filter per betaGroups request. The caller has
// already resolved this build through the app-scoped builds query.
export async function readTestFlightDistribution(asc, buildId) {
  try {
    const params = new URLSearchParams({
      'filter[builds]': buildId,
      'fields[betaGroups]': 'isInternalGroup,hasAccessToAllBuilds', limit: '200',
    });
    const [detail, groups] = await Promise.all([
      asc(`/v1/builds/${encodeURIComponent(buildId)}/buildBetaDetail`),
      asc(`/v1/betaGroups?${params}`),
    ]);
    return {
      verified: true,
      internalBuildState: detail.data?.attributes?.internalBuildState ?? null,
      externalBuildState: detail.data?.attributes?.externalBuildState ?? null,
      groups: (groups.data || []).map(group => ({
        id: group.id,
        isInternalGroup: group.attributes?.isInternalGroup ?? null,
        hasAccessToAllBuilds: group.attributes?.hasAccessToAllBuilds ?? null,
      })),
      groupListComplete: !groups.links?.next,
      testersOrGroupsChanged: false,
    };
  } catch (error) {
    return { verified: false, reason: error.message, testersOrGroupsChanged: false };
  }
}
