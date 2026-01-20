import { createHash } from "node:crypto";
import { arch, platform } from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";

import { getErrors, unwrap } from "./either";
import { getOctokit, Octokit } from "./octokit";
import {
  parseEnvironmentVariable,
  parseTargetReleases,
  parseToken,
} from "./parse";
import { getTargetTriple, getTargetDuple, getTargetDupleUnderscore } from "./platform";
import {
  fetchReleaseAssetMetadataFromTag,
  findExactSemanticVersionTag,
} from "./fetch";
import type {
  ExactSemanticVersion,
  RepositorySlug,
  TargetRelease,
} from "./types";
import { isSome, unwrapOrDefault } from "./option";

/**
 * Check if a file is a zip archive based on its extension
 */
function isZipFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip');
}

function getDestinationDirectory(
  storageDirectory: string,
  slug: RepositorySlug,
  tag: ExactSemanticVersion,
  platform: NodeJS.Platform,
  architecture: string,
): string {
  return path.join(
    storageDirectory,
    slug.owner.toLowerCase(),
    slug.repository.toLowerCase(),
    tag,
    `${platform}-${architecture}`,
  );
}

async function installGitHubReleaseBinary(
  octokit: Octokit,
  targetRelease: TargetRelease,
  storageDirectory: string,
  token: string,
  ignoreExisting: boolean,
): Promise<void> {
  const currentArch = arch();
  const currentPlatform = platform();
  const targetTriple = getTargetTriple(currentArch, currentPlatform);
  const targetDuple = getTargetDuple(currentArch, currentPlatform);
  const targetDupleUnderscore = getTargetDupleUnderscore(currentArch, currentPlatform);

  const releaseTag = await findExactSemanticVersionTag(
    octokit,
    targetRelease.slug,
    targetRelease.tag,
  );

  const destinationDirectory = getDestinationDirectory(
    storageDirectory,
    targetRelease.slug,
    releaseTag,
    currentPlatform,
    currentArch,
  );

  const releaseAsset = await fetchReleaseAssetMetadataFromTag(
    octokit,
    targetRelease.slug,
    targetRelease.binaryName,
    releaseTag,
    targetTriple,
    targetDuple,
    targetDupleUnderscore,
  );

  const destinationBasename = unwrapOrDefault(
    releaseAsset.binaryName,
    targetRelease.slug.repository,
  );

  // Create the destination directory
  fs.mkdirSync(destinationDirectory, { recursive: true });

  // Determine if we're dealing with a zip file based on the asset name
  const assetName = releaseAsset.name || '';
  core.debug(`Asset name: ${assetName}`);
  const isZip = isZipFile(assetName);

  // If it's a standard binary, use the existing destination path
  // If it's a zip, we'll create a temporary file path for the download
  const destinationFilename = isZip
    ? path.join(destinationDirectory, `${destinationBasename}.zip`)
    : path.join(destinationDirectory, destinationBasename);

  // Final binary path to check/add to PATH (same for non-zip, different for zip)
  const finalBinaryPath = path.join(destinationDirectory, destinationBasename);

  // Check if file already exists and skip if ignoreExisting is true
  if (fs.existsSync(finalBinaryPath)) {
    if (ignoreExisting) {
      core.info(`Binary already exists at ${finalBinaryPath}, ignoring and leaving system as-is`);
      // Still add the directory to PATH so the binary can be found
      core.addPath(destinationDirectory);
      return;
    }
  }

  // Download the file
  const downloadedFilePath = await tc.downloadTool(
    releaseAsset.url,
    destinationFilename,
    `token ${token}`,
    { accept: "application/octet-stream" },
  );

  // Ensure the downloaded file matches the expected checksum
  if (isSome(targetRelease.checksum)) {
    const fileBuffer = fs.readFileSync(downloadedFilePath);
    const hash = createHash("sha256");
    hash.update(fileBuffer);
    const calculatedChecksum = hash.digest("hex");
    const expectedChecksum = targetRelease.checksum.value;
    if (calculatedChecksum !== expectedChecksum) {
      const target = `${targetRelease.slug}@${targetRelease.tag}:sha256-${expectedChecksum}`;
      core.error(
        `Expected checksum ${expectedChecksum}, but got ${calculatedChecksum}`,
      );
      throw new Error(`Unexpected checksum for ${target}`);
    } else {
      core.debug(
        `Calculated checksum ${calculatedChecksum} matches expected checksum ${expectedChecksum}`,
      );
    }
  }

  // Process the file based on type
  if (isZip) {
    core.info(`Detected zip archive based on filename: ${assetName}`);
    core.info(`Extracting zip file: ${downloadedFilePath}`);

    // Extract the zip file
    const extractedDirectory = await tc.extractZip(downloadedFilePath, destinationDirectory);
    core.debug(`Files extracted to ${extractedDirectory}`);

    // We assume there's exactly one binary file in the archive
    // If there's more than one file or if it's a directory, throw an error
    const extractedFiles = fs.readdirSync(extractedDirectory);

    // Filter out hidden files and directories
    const visibleFiles = extractedFiles.filter(file =>
      !file.startsWith('.') && !fs.statSync(path.join(extractedDirectory, file)).isDirectory()
    );

    if (visibleFiles.length !== 1) {
      throw new Error(`Expected exactly one binary in the zip archive, but found ${visibleFiles.length} files: ${visibleFiles.join(', ')}`);
    }

    // Use the single binary file - we've already checked that there's exactly one file
    // TypeScript needs a non-null assertion here to know it's safe
    const binaryName: string = visibleFiles[0]!;
    core.debug(`Found single binary in zip: ${binaryName}`);

    // Move the binary to the destination
    fs.renameSync(
      path.join(extractedDirectory, binaryName),
      finalBinaryPath
    );

    // Clean up the extracted directory
    if (extractedDirectory !== destinationDirectory) {
      core.debug(`Removing temporary extraction directory: ${extractedDirectory}`);
      fs.rmSync(extractedDirectory, { recursive: true, force: true });
    }

    // Clean up the zip file
    core.debug(`Removing zip file: ${downloadedFilePath}`);
    fs.unlinkSync(downloadedFilePath);
  } else {
    // For regular binaries, the downloaded file is already at the right location
    core.debug(`Downloaded binary file: ${downloadedFilePath}`);
  }

  // Permissions are an attribute of the filesystem, not the file.
  // Set the executable permission on the binary no matter where it came from.
  fs.chmodSync(finalBinaryPath, "755");
  core.addPath(destinationDirectory);
}

async function main(): Promise<void> {
  const maybeToken = parseToken(
    process.env["GITHUB_TOKEN"] || core.getInput("token"),
  );
  const maybeTargetReleases = parseTargetReleases(core.getInput("targets"));
  const maybeHomeDirectory = parseEnvironmentVariable("HOME");
  const ignoreExisting = core.getBooleanInput("ignore-existing-binary");

  const errors = [maybeToken, maybeTargetReleases, maybeHomeDirectory].flatMap(
    getErrors,
  );
  if (errors.length > 0) {
    errors.forEach((error) => core.error(error));
    throw new Error("Invalid inputs");
  }

  const token = unwrap(maybeToken);
  const targetReleases = unwrap(maybeTargetReleases);
  const homeDirectory = unwrap(maybeHomeDirectory);

  const storageDirectory = path.join(
    homeDirectory,
    ".install-github-release-binary",
    "bin",
  );
  const octokit = getOctokit(token);

  // REFACTOR(OPTIMIZE): if two targets can be pulled from the same
  // release, we can make that happen with fewer API calls
  await Promise.all(
    targetReleases.map((targetRelease) =>
      installGitHubReleaseBinary(
        octokit,
        targetRelease,
        storageDirectory,
        token,
        ignoreExisting,
      ),
    ),
  );
}

main();
