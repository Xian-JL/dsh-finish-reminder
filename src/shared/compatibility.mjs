// Explicitly reviewed prereleases. Do not silently include a future RC or stable release.
export const REVIEWED_DSH_VERSIONS=Object.freeze(['0.2.2-rc.1','0.2.2-rc.3']);
export const DSH_ENGINE_RANGE=REVIEWED_DSH_VERSIONS.join(' || ');
