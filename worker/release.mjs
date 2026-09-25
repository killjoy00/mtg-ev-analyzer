// The release builder embeds the reviewed Git commit in every deployed bundle.
// Local imports intentionally report null; an unmarked build cannot pass promotion.
export const releaseMetadata=()=>({release_commit:process.env.PACK1_RELEASE_COMMIT||null});
