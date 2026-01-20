import type { Octokit } from "./octokit";
import { isEqual, isSome, none, Option, some } from "./option";
import { stripTargetTriple } from "./platform";
import type { TargetDuple } from "./types";

import {
  isExactSemanticVersion,
  ExactSemanticVersion,
  RepositorySlug,
  SemanticVersion,
  Sha1Hash,
  TargetTriple,
  BinaryName,
} from "./types";

type Commit = {
  sha: Sha1Hash;
};

// This type is only exported for testing.
export type Tag = {
  name: SemanticVersion;
  commit: Commit;
};

export type TagsResponse = ReadonlyArray<Tag>;

function containsExactTag(
  tags: readonly SemanticVersion[] | undefined,
): ExactSemanticVersion | undefined {
  if (tags === undefined) {
    return undefined;
  }
  return tags.find(isExactSemanticVersion);
}

// This function is only exported for testing.
export function semanticVersionTagReducer(
  givenTag: SemanticVersion,
): (tag: Tag) => Option<ExactSemanticVersion> {
  const versionsBySha: Record<Sha1Hash, SemanticVersion[]> = {};
  let givenTagSha: Option<Sha1Hash> = none();

  // Conditions for an exact match are -- we know both the:
  //
  // - sha that the given tag points to
  // - exact version tag matching that sha
  //
  // These can be found in either order.
  return function reducer(tag: Tag): Option<ExactSemanticVersion> {
    const sha = tag.commit.sha;
    const version = tag.name;

    // If we found the sha the given tag points to
    if (version === givenTag) {
      givenTagSha = some(sha);
      // check if we already knew the exact version tag matching that sha
      const maybeExactTag = containsExactTag(versionsBySha[sha]);
      if (maybeExactTag !== undefined) {
        return some(maybeExactTag);
      }
    }

    // If we're not looking at the given tag, and we're not looking
    // at an exact version, this data is of no use to us.
    if (!isExactSemanticVersion(version)) {
      return none();
    }

    // It is possible that we know the sha for the given tag,
    // we're just looking for exact version tag matching that sha.
    if (isEqual(givenTagSha, sha)) {
      return some(version);
    }

    // Otherwise, record this map of sha -> exact version tag
    // so we can find it when we know the sha of the given tag.
    const associatedVersions = versionsBySha[sha];
    if (associatedVersions === undefined) {
      versionsBySha[sha] = [version];
    } else {
      associatedVersions.push(version);
    }

    return none();
  };
}

// Find the exact semantic version tag that this tag maps to.
//
// We need an exact tag because that's the only accepted input
// to GitHub's getReleaseByTag endpoint.
export async function findExactSemanticVersionTag(
  octokit: Octokit,
  slug: RepositorySlug,
  target: SemanticVersion,
): Promise<ExactSemanticVersion> {
  if (isExactSemanticVersion(target)) {
    return target;
  }

  const reducer = semanticVersionTagReducer(target);

  for await (const response of octokit.paginate.iterator(
    octokit.rest.repos.listTags,
    {
      owner: slug.owner,
      repo: slug.repository,
      per_page: 100,
    },
  )) {
    // NOTE: we are not parsing here, so this is an unlawful type cast
    for (const tag of response.data as unknown as TagsResponse) {
      const maybeExactTag = reducer(tag);
      if (isSome(maybeExactTag)) {
        return maybeExactTag.value;
      }
    }
  }

  throw new Error(
    `Expected to find an exact semantic version tag matching ${target} for ${slug.owner}/${slug.repository}`,
  );
}

type ReleaseAssetMetadata = {
  binaryName: Option<string>;
  url: string;
  name?: string;
};

/**
 * Type for GitHub release metadata required by our function
 */
export type ReleaseMetadataResponse = {
  data: {
    assets: Array<{
      label?: string | null;
      name?: string;
      url: string;
      // Other fields may exist but we don't use them
    }>;
  };
};

/**
 * Extract matching asset metadata from release assets based on target platform format
 */
export function findMatchingReleaseAssetMetadata(
  releaseMetadata: ReleaseMetadataResponse,
  slug: RepositorySlug,
  binaryName: Option<BinaryName>,
  tag: ExactSemanticVersion,
  targetTriple: TargetTriple,
  targetDuple: TargetDuple,
  targetDupleUnderscore?: TargetDuple,
): ReleaseAssetMetadata {
  // When the binary name is provided, look for matching binary with target triple or target duple
  if (isSome(binaryName)) {
    // Standard hyphen format for target triple and duple
    const targetLabelTraditional = `${binaryName.value}-${targetTriple}`;
    const targetLabelDuple = `${binaryName.value}-${targetDuple}`;

    // Underscore format for target duple (if provided)
    const targetLabelDupleUnderscore = targetDupleUnderscore ?
      `${binaryName.value}_${targetDupleUnderscore}` : '';

    const asset = releaseMetadata.data.assets.find((asset) => {
      // Check for label match
      if (typeof asset.label === "string") {
        if (asset.label === targetLabelTraditional ||
            asset.label === targetLabelDuple ||
            (targetLabelDupleUnderscore && asset.label === targetLabelDupleUnderscore)) {
          return true;
        }
      }

      // Check for name match
      if (typeof asset.name === "string") {
        if (asset.name === targetLabelTraditional ||
            asset.name === targetLabelDuple ||
            (targetLabelDupleUnderscore && asset.name === targetLabelDupleUnderscore)) {
          return true;
        }
      }

      return false;
    });

    if (asset === undefined) {
      const formats = [targetLabelTraditional, targetLabelDuple];
      if (targetDupleUnderscore) {
        formats.push(targetLabelDupleUnderscore);
      }
      throw new Error(
        `Expected to find asset in release ${slug.owner}/${slug.repository}@${tag} with label or name ${formats.join(" or ")}`,
      );
    }

    return {
      binaryName: binaryName,
      url: asset.url,
      name: asset.name || '',
    };
  }

  // When the binary name is not provided, support these use cases:
  // 1. There is only one binary uploaded to this release, a named binary.
  // 2. There is an asset label matching the target triple or target duple.
  // In both cases, we assume that's the binary the user meant.
  // If there is ambiguity, exit with an error.
  const matchingAssets = releaseMetadata.data.assets.filter((asset) => {
    // Helper function to check if a name contains the platform identifier at the end
    const endsWithPlatform = (name: string) => {
      // Get just the filename part without the extension
      const filenameWithoutExt = name.replace(/\.[^.]+$/, '');

      return (
        // Traditional formats with platform at the end
        filenameWithoutExt.endsWith(targetTriple) ||
        filenameWithoutExt.endsWith(targetDuple) ||
        (targetDupleUnderscore && filenameWithoutExt.endsWith(targetDupleUnderscore))
      );
    };

    // Check label match
    if (typeof asset.label === "string") {
      if (endsWithPlatform(asset.label)) {
        return true;
      }
    }

    // Check name match
    if (typeof asset.name === "string") {
      if (endsWithPlatform(asset.name)) {
        return true;
      }
    }

    return false;
  });
  if (matchingAssets.length === 0) {
    const formats = [targetTriple, targetDuple];
    if (targetDupleUnderscore) {
      formats.push(targetDupleUnderscore);
    }
    throw new Error(
      `Expected to find asset in release ${slug.owner}/${slug.repository}@${tag} with label or name containing platform identifier ${formats.join(" or ")} at the end of the filename (before the extension)`,
    );
  }
  if (matchingAssets.length > 1) {
    const formats = [targetTriple, targetDuple];
    if (targetDupleUnderscore) {
      formats.push(targetDupleUnderscore);
    }
    throw new Error(
      `Ambiguous targets: expected to find a single asset in release ${slug.owner}/${slug.repository}@${tag} containing platform identifier ${formats.join(" or ")} at the end of the filename (before the extension), but found ${matchingAssets.length}.

To resolve, specify the desired binary with the target format ${slug.owner}/${slug.repository}/<binary-name>@${tag}`,
    );
  }
  const asset = matchingAssets.shift()!;

  // Determine which field matched to use for stripping the target triple
  let matchField: string;
  if (typeof asset.label === "string" &&
      (asset.label.endsWith(targetTriple) || asset.label.endsWith(targetDuple))) {
    matchField = asset.label;
  } else {
    matchField = asset.name!;
  }

  const targetName = stripTargetTriple(matchField);
  return {
    binaryName: targetName,
    url: asset.url,
    name: asset.name || '',
  };
}

export async function fetchReleaseAssetMetadataFromTag(
  octokit: Octokit,
  slug: RepositorySlug,
  binaryName: Option<BinaryName>,
  tag: ExactSemanticVersion,
  targetTriple: TargetTriple,
  targetDuple: TargetDuple,
  targetDupleUnderscore?: TargetDuple,
): Promise<ReleaseAssetMetadata> {
  // Maintainer's note: this impure function call makes this function difficult to test.
  const releaseMetadata = await octokit.rest.repos.getReleaseByTag({
    owner: slug.owner,
    repo: slug.repository,
    tag,
  });

  return findMatchingReleaseAssetMetadata(
    releaseMetadata,
    slug,
    binaryName,
    tag,
    targetTriple,
    targetDuple,
    targetDupleUnderscore,
  );
}
