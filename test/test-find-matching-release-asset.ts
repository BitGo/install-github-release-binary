import test from "node:test";
import assert from "node:assert/strict";

import { none, some } from "../src/option";
import { findMatchingReleaseAssetMetadata } from "../src/fetch";
import type { ExactSemanticVersion, RepositorySlug, BinaryName, TargetTriple, TargetDuple } from "../src/types";

// Mocked releaseMetadata for tests
function mockReleaseMetadata(assets: Array<{ label?: string; name?: string; url: string }>) {
  return {
    data: { assets }
  };
}

// Mock slug for tests
const mockSlug: RepositorySlug = {
  owner: "testowner",
  repository: "testrepo",
} as unknown as RepositorySlug;

// Mock tag for tests
const mockTag: ExactSemanticVersion = "v1.0.0" as unknown as ExactSemanticVersion;

// Mock targetTriple and targetDuple for tests
const targetTriple: TargetTriple = "aarch64-apple-darwin" as unknown as TargetTriple;
const targetDuple: TargetDuple = "darwin-arm64" as unknown as TargetDuple;
const x86TargetTriple: TargetTriple = "x86_64-apple-darwin" as unknown as TargetTriple;
const x86TargetDuple: TargetDuple = "darwin-amd64" as unknown as TargetDuple;

// Test with binary name provided
test("should find asset with binary name using target triple", () => {
  const binaryName = some("testbin" as unknown as BinaryName);
  const mockAssets = [
    { label: "testbin-aarch64-apple-darwin", url: "https://example.com/testbin-triple" },
    { label: "testbin-darwin-arm64", url: "https://example.com/testbin-duple" },
    { label: "otherbin-aarch64-apple-darwin", url: "https://example.com/otherbin" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    binaryName,
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName,
    url: "https://example.com/testbin-triple"
  });
});

test("should find asset with binary name using target duple", () => {
  const binaryName = some("testbin" as unknown as BinaryName);
  const mockAssets = [
    { label: "testbin-darwin-arm64", url: "https://example.com/testbin-duple" },
    { label: "otherbin-aarch64-apple-darwin", url: "https://example.com/otherbin" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    binaryName,
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName,
    url: "https://example.com/testbin-duple"
  });
});

test("should throw error when binary name provided but no matching asset found", () => {
  const binaryName = some("testbin" as unknown as BinaryName);
  const mockAssets = [
    { label: "otherbin-aarch64-apple-darwin", url: "https://example.com/otherbin" },
    { label: "otherbin-darwin-arm64", url: "https://example.com/otherbin-duple" },
  ];

  assert.throws(() => {
    findMatchingReleaseAssetMetadata(
      mockReleaseMetadata(mockAssets),
      mockSlug,
      binaryName,
      mockTag,
      targetTriple,
      targetDuple
    );
  }, new Error(`Expected to find asset in release testowner/testrepo@v1.0.0 with label or name testbin-aarch64-apple-darwin or testbin-darwin-arm64`));
});

// Test without binary name
test("should find asset without binary name using target triple", () => {
  const mockAssets = [
    { label: "somebin-aarch64-apple-darwin", url: "https://example.com/somebin-triple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    none(),
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName: some("somebin"),
    url: "https://example.com/somebin-triple"
  });
});

test("should find asset without binary name using target duple", () => {
  const mockAssets = [
    { label: "somebin-darwin-arm64", url: "https://example.com/somebin-duple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    none(),
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName: some("somebin"),
    url: "https://example.com/somebin-duple"
  });
});

test("should throw error when no binary name provided and no matching asset found", () => {
  const mockAssets = [
    { label: "somebin-windows-x64", url: "https://example.com/somebin-windows" },
  ];

  assert.throws(() => {
    findMatchingReleaseAssetMetadata(
      mockReleaseMetadata(mockAssets),
      mockSlug,
      none(),
      mockTag,
      targetTriple,
      targetDuple
    );
  }, new Error(`Expected to find asset in release testowner/testrepo@v1.0.0 with label or name ending in aarch64-apple-darwin or darwin-arm64`));
});

test("should throw error when multiple assets match without binary name", () => {
  const mockAssets = [
    { label: "bin1-aarch64-apple-darwin", url: "https://example.com/bin1" },
    { label: "bin2-aarch64-apple-darwin", url: "https://example.com/bin2" },
  ];

  assert.throws(() => {
    findMatchingReleaseAssetMetadata(
      mockReleaseMetadata(mockAssets),
      mockSlug,
      none(),
      mockTag,
      targetTriple,
      targetDuple
    );
  }, (err: Error) => err.message.startsWith("Ambiguous targets:"));
});

test("should handle both target triple and duple formats in the same release", () => {
  const mockAssets = [
    { label: "bin1-aarch64-apple-darwin", url: "https://example.com/bin1-triple" },
    { label: "bin2-darwin-arm64", url: "https://example.com/bin2-duple" },
  ];

  assert.throws(() => {
    findMatchingReleaseAssetMetadata(
      mockReleaseMetadata(mockAssets),
      mockSlug,
      none(),
      mockTag,
      targetTriple,
      targetDuple
    );
  }, (err: Error) => err.message.startsWith("Ambiguous targets:"));
});

test("should find x86_64 asset with binary name using target triple", () => {
  const binaryName = some("testbin" as unknown as BinaryName);
  const mockAssets = [
    { label: "testbin-x86_64-apple-darwin", url: "https://example.com/testbin-x86-triple" },
    { label: "testbin-darwin-amd64", url: "https://example.com/testbin-x86-duple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    binaryName,
    mockTag,
    x86TargetTriple,
    x86TargetDuple
  );

  assert.deepEqual(result, {
    binaryName,
    url: "https://example.com/testbin-x86-triple"
  });
});

test("should find x86_64 asset with binary name using target duple", () => {
  const binaryName = some("testbin" as unknown as BinaryName);
  const mockAssets = [
    { label: "testbin-darwin-amd64", url: "https://example.com/testbin-x86-duple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    binaryName,
    mockTag,
    x86TargetTriple,
    x86TargetDuple
  );

  assert.deepEqual(result, {
    binaryName,
    url: "https://example.com/testbin-x86-duple"
  });
});

// Tests for the new feature: finding assets by name property
test("should find asset with binary name using name property with target triple", () => {
  const binaryName = some("testbin" as unknown as BinaryName);
  const mockAssets = [
    // No label property, only name property
    { name: "testbin-aarch64-apple-darwin", url: "https://example.com/testbin-triple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    binaryName,
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName,
    url: "https://example.com/testbin-triple"
  });
});

test("should find asset with binary name using name property with target duple", () => {
  const binaryName = some("testbin" as unknown as BinaryName);
  const mockAssets = [
    // No label property, only name property
    { name: "testbin-darwin-arm64", url: "https://example.com/testbin-duple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    binaryName,
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName,
    url: "https://example.com/testbin-duple"
  });
});

test("should find asset without binary name using name property with target triple", () => {
  const mockAssets = [
    // No label property, only name property
    { name: "somebin-aarch64-apple-darwin", url: "https://example.com/somebin-triple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    none(),
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName: some("somebin"),
    url: "https://example.com/somebin-triple"
  });
});

test("should find asset without binary name using name property with target duple", () => {
  const mockAssets = [
    // No label property, only name property
    { name: "somebin-darwin-arm64", url: "https://example.com/somebin-duple" },
  ];

  const result = findMatchingReleaseAssetMetadata(
    mockReleaseMetadata(mockAssets),
    mockSlug,
    none(),
    mockTag,
    targetTriple,
    targetDuple
  );

  assert.deepEqual(result, {
    binaryName: some("somebin"),
    url: "https://example.com/somebin-duple"
  });
});