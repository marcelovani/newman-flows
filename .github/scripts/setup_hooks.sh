#!/bin/bash

echo "Setting up Git hooks..."

HOOK_SRC_DIR=".github/hooks"
GIT_HOOK_DIR=".git/hooks"

# Skip silently when not in a Git repository (e.g. deploy artifact builds).
if [ ! -d ".git" ]; then
  exit 0
fi

# Copy hooks
cp -a "$HOOK_SRC_DIR/." "$GIT_HOOK_DIR/"

echo "Git hooks have been set up successfully in $GIT_HOOK_DIR"
