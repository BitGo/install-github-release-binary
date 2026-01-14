import test from "node:test";
import assert from "node:assert/strict";

import { Option, none, some } from "../src/option";
import { stripTargetTriple } from "../src/platform";

function check(input: string, expectedOutput: Option<string>) {
  // wrap in a thunk so we can pass it directly to `test`
  return function () {
    assert.deepEqual(stripTargetTriple(input), expectedOutput);
  };
}

test(
  "should strip aarch64-apple-darwin",
  check("darwin-thing-aarch64-apple-darwin", some("darwin-thing")),
);

test(
  "should strip x86_64-apple-darwin",
  check("foo-x86_64-apple-darwin", some("foo")),
);

test(
  "should strip aarch64-unknown-linux-musl",
  check("foo-aarch64-unknown-linux-musl", some("foo")),
);

test(
  "should strip x86_64-unknown-linux-musl",
  check("foo-x86_64-unknown-linux-musl", some("foo")),
);

test(
  "should strip a target triple into none",
  check("x86_64-unknown-linux-musl", none()),
);

// Test stripping target duples
test(
  "should strip darwin-arm64",
  check("myapp-darwin-arm64", some("myapp")),
);

test(
  "should strip darwin-amd64",
  check("myapp-darwin-amd64", some("myapp")),
);

test(
  "should strip linux-arm64",
  check("myapp-linux-arm64", some("myapp")),
);

test(
  "should strip linux-amd64",
  check("myapp-linux-amd64", some("myapp")),
);

test(
  "should strip a target duple into none",
  check("darwin-arm64", none()),
);
