#!/bin/sh
# Put the `flex` command on your PATH: a release build, copied to ~/.flex/bin (a copy, so cleaning target/ keeps it), which goes first on the PATH (macOS ships
# an unrelated /usr/bin/flex, the lexer generator; this one wins in your shells and in the tools Flex starts).
#   scripts/install-cli.sh        (again after pulling, to rebuild)
set -eu
cd "$(dirname "$0")/.."
cargo build --release -p flex-cli
mkdir -p "$HOME/.flex/bin"
rm -f "$HOME/.flex/bin/flex" && cp "$PWD/target/release/flex" "$HOME/.flex/bin/flex"
LINE='export PATH="$HOME/.flex/bin:$PATH" # Flex CLI first (macOS has an unrelated /usr/bin/flex): flex/scripts/install-cli.sh'
for rc in "$HOME/.zshrc"; do
  grep -qF '.flex/bin' "$rc" 2>/dev/null || printf '\n%s\n' "$LINE" >> "$rc"
done
echo "flex → $HOME/.flex/bin/flex (open a new terminal, then: flex doctor)"
